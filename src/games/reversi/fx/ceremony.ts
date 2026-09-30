import type { SilenceHandle, SoundHandle } from '../../../juice/audio/engine.ts';
import type { FrameTime } from '../../../juice/frame-time.ts';
import { CEREMONY, CEREMONY_MOTION, HAPTICS, WARP_ARRIVE } from '../config.ts';
import type { PullTuning } from '../config.ts';
import { cellX, cellY } from '../geometry.ts';
import { BOARD_SIZE, opponentOf, SQUARES } from '../rules/position.ts';
import type { Color } from '../rules/position.ts';
import { SCORE } from '../scoring.ts';
import type { Callout, RunResult, Side } from '../types.ts';
import { LOOK } from '../view/look.ts';
import type { DiscField } from './discs.ts';

/** 儀式から鳴らす音。rising は上がっていく音にするか（勝ちだけ） */
type CeremonySfx = {
  gatherLift(duration: number, rising: boolean): void;
  vanish(): void;
  countTick(side: Side, index: number, alone: boolean, rising: boolean): void;
  inhale(duration: number): SoundHandle;
  verdict(outcome: 'win' | 'lose' | 'draw', perfect: boolean): void;
};

/** 効果音と BGM を一時的に消す口（AudioEngine.silence） */
export type SilencePort = { silence(duration: number, fadeIn?: number, delay?: number): SilenceHandle };

/** 儀式が動かす画面全体の空気（Atmosphere の一部） */
type CeremonyAir = {
  flare(real: number, flash: number, boost: number): boolean;
  kick(v: number): void;
  darken(v: number): void;
  spreadRays(v: number): void;
  prism(v: number): void;
  muteRiser(): void;
};

/** 儀式が画面に出す文字 */
type CeremonyCallout = Extract<Callout, { kind: 'tally' | 'verdict' }>;

type CeremonyDeps = {
  /** 人の色 */
  human: Color;
  /** world を present へ直す足し算 */
  presentOffset: number;
  discs: DiscField;
  sfx: CeremonySfx;
  audio: SilencePort;
  air: CeremonyAir;
  camera: { addTrauma(amount: number): void; pull(amount: number, attack: number, release: number): void };
  particles: {
    flipLanded(now: number, x: number, y: number, color: Color, side: Side, order: number, budget: number): void;
    fireworks(now: number, x: number, y: number, color: Color, budget: number): void;
  };
  /** 衝撃波を放つ（present の時刻、中心、速さ） */
  shockwave(at: number, x: number, y: number, speed: number): void;
  vibrate(pattern: number | readonly number[]): void;
  callout(c: CeremonyCallout): void;
  /** HUD の得点に足す */
  addScore(points: number): void;
};

/** 1 組の石が並べ直す位置に現れて、数える 1 回。human と cpu は、その回に数えるマス（数え終えた側は -1） */
type Tick = { at: number; human: number; cpu: number; index: number };

/** 盤の中心（ワールド座標） */
const CENTER = BOARD_SIZE / 2;

const pull = (camera: CeremonyDeps['camera'], p: PullTuning): void => camera.pull(p.amount, p.attack, p.release);

/**
 * 終局の儀式。
 * 1. 全部の石が一度に跳ねる
 * 2. 1 組（人の石と CPU の石 1 つずつ）ずつ、だんだん速く、元の位置で縮んで消え、少し間を置いて色ごとに並べ直す位置に大きく現れる
 *    （人の石は左上から、CPU の石は右下から）。現れた瞬間にその組を数え、人の石の点を HUD の得点に入れる。多い側だけが最後まで続ける
 * 3. 無音で溜め、決着を叩きつける。勝ちは衝撃波・花火・明るい和音、負けは石を暗くして低い和音
 * 4. 勝ちだけ、人の石が中心から外へ波のように跳ねて締める
 * 上がっていく音・溜めの吸い込む音・外へ弾ける粒・光・演出の強さの上乗せは勝ちだけに付け、負けと引き分けには付けない。
 * 儀式を終えると、HUD の得点は対局中の得点に石の点を足した値になる。
 * タップで飛ばせる。飛ばしても結果は変わらない。
 */
export class Ceremony {
  private readonly d: CeremonyDeps;
  private result: RunResult | null = null;
  private finishedFlag = false;
  /** 数えた数（HUD に出す） */
  countedHuman = 0;
  countedCpu = 0;
  /** 組ごとに消え始める世界時間と、現れて数える回 */
  private vanishes: number[] = [];
  private nextVanish = 0;
  private ticks: Tick[] = [];
  private next = 0;
  private verdictAt = Infinity;
  private hushAt = Infinity;
  private waveAt = Infinity;
  private finishAt = Infinity;
  private verdictDone = false;
  private waveDone = false;
  /** 決着の演出をした present の時刻（負けた側の石を暗くし始めた時刻） */
  private verdictPresent = 0;
  /** 最後に進めたフレームの present の時刻 */
  private present = 0;
  private hushDone = false;
  private humanSlots: number[] = [];
  private cpuSlots: number[] = [];
  /** 儀式で HUD の得点に足した点 */
  private added = 0;
  private silenceHandle: SilenceHandle | null = null;
  private inhaleHandle: SoundHandle | null = null;

  constructor(deps: CeremonyDeps) {
    this.d = deps;
  }

  /** 儀式が始まっているか。始まったら、HUD の石の数は数え上げた数になる */
  get started(): boolean {
    return this.result !== null;
  }

  private get won(): boolean {
    return this.result?.outcome === 'win';
  }

  /** 儀式を始める。盤に見えている石を、1 組ずつ色ごとに並べ直す位置へ移す予定を DiscField へ書き、数える予定を立てる */
  start(ft: FrameTime, result: RunResult): void {
    if (this.result) return;
    this.result = result;
    this.present = ft.present;
    const { human, presentOffset, discs } = this.d;
    const cpu = opponentOf(human);
    const humanSrc: number[] = [];
    const cpuSrc: number[] = [];
    for (let s = 0; s < SQUARES; s++) {
      if (discs.shown[s] === human) humanSrc.push(s);
      else if (discs.shown[s] === cpu) cpuSrc.push(s);
    }
    this.humanSlots = humanSrc.map((_, i) => i);
    this.cpuSlots = cpuSrc.map((_, i) => SQUARES - 1 - i);

    const t0 = ft.world;
    const present = (w: number) => presentOffset + w;
    // 全マスを空にしてから（印と確定石の光も消える）、石ごとに元の位置と移し始める時刻を書く。
    // 移し始めるまでは元の位置にあり、全部の石が今一度に跳ねる
    discs.clear();
    const move = (src: number, to: number, color: Color, at: number) => {
      discs.gather(to, color, cellX(src), cellY(src), present(at));
      discs.counted(to, present(t0));
    };
    // 1 組ずつ、だんだん速く移し、現れた瞬間に数える。片方が数え終えたら、多い側だけが続ける
    let at = t0 + CEREMONY.lift;
    let gap: number = CEREMONY.gapStart;
    let lastArrive = at;
    const total = Math.max(humanSrc.length, cpuSrc.length);
    for (let i = 0; i < total; i++) {
      const h = i < humanSrc.length ? this.humanSlots[i] : -1;
      const c = i < cpuSrc.length ? this.cpuSlots[i] : -1;
      if (h >= 0) move(humanSrc[i], h, human, at);
      if (c >= 0) move(cpuSrc[i], c, cpu, at);
      this.vanishes.push(at);
      lastArrive = at + WARP_ARRIVE;
      this.ticks.push({ at: lastArrive, human: h, cpu: c, index: i });
      at += gap;
      gap = Math.max(CEREMONY.gapMin, gap * CEREMONY.gapDecay);
    }
    this.d.sfx.gatherLift(CEREMONY.lift, this.won);
    this.hushAt = lastArrive + CEREMONY.countHold;
    this.verdictAt = this.hushAt + CEREMONY.hush;
    this.waveAt = this.verdictAt + CEREMONY.waveLead;
    const settle = result.perfect ? CEREMONY.settlePerfect : result.outcome === 'win' ? CEREMONY.settleWin : CEREMONY.settleOther;
    this.finishAt = this.waveAt + settle;
    this.d.air.muteRiser();
    pull(this.d.camera, CEREMONY_MOTION.start.pull);
  }

  /** 1 フレーム進める。結果画面へ移るフレームで 1 回だけ true */
  update(ft: FrameTime, budget: number): boolean {
    if (!this.result || this.finishedFlag) return false;
    const d = this.d;
    const w = ft.world;
    this.present = ft.present;
    while (this.nextVanish < this.vanishes.length && this.vanishes[this.nextVanish] <= w) {
      this.nextVanish++;
      d.sfx.vanish();
    }
    while (this.next < this.ticks.length && this.ticks[this.next].at <= w) this.tick(this.ticks[this.next++], budget);
    if (!this.hushDone && w >= this.hushAt) {
      this.hushDone = true;
      const dur = CEREMONY.hush;
      this.silenceHandle = d.audio.silence(dur, 0.01);
      // 上がっていく吸い込みの音は勝ちだけ。負けと引き分けは無音だけで溜める
      if (this.won) this.inhaleHandle = d.sfx.inhale(dur);
    }
    if (!this.verdictDone && w >= this.verdictAt) {
      this.verdictDone = true;
      this.verdict(ft, budget);
    }
    if (!this.waveDone && w >= this.waveAt) {
      this.waveDone = true;
      this.wave(ft);
    }
    if (w >= this.finishAt) {
      this.finishedFlag = true;
      return true;
    }
    return false;
  }

  /**
   * タップで飛ばす。並べ直しと数え上げを終え、負けた側の石を暗くした、儀式を終えたときと同じ盤にして、すぐに結果へ進む。
   * 飛ばせたら true
   */
  skip(): boolean {
    const r = this.result;
    if (!r || this.finishedFlag) return false;
    const d = this.d;
    this.stopHush();
    const cpu = opponentOf(d.human);
    d.discs.clear();
    for (const s of this.humanSlots) d.discs.place(s, d.human);
    for (const s of this.cpuSlots) d.discs.place(s, cpu);
    // 並べ直すと石の暗さも消えるので、決着の後なら同じ時刻から、決着の前なら今から暗くする
    this.dimLoser(this.verdictDone ? this.verdictPresent : this.present);
    this.countedHuman = this.humanSlots.length;
    this.countedCpu = this.cpuSlots.length;
    this.add(r.score.discPoints - this.added);
    this.finishedFlag = true;
    return true;
  }

  /** 溜めの無音と吸い込む音を今すぐやめる（スキップやプレイの破棄） */
  stopHush(): void {
    const silence = this.silenceHandle;
    const inhale = this.inhaleHandle;
    this.silenceHandle = null;
    this.inhaleHandle = null;
    silence?.cancel();
    inhale?.stop();
  }

  private add(points: number): void {
    if (points <= 0) return;
    this.added += points;
    this.d.addScore(points);
  }

  /** 1 組が並べ直す位置に現れたので数える。石は跳ね、人の石の点を HUD へ入れて、集計の文字（両方の数）を更新する。勝つときだけ粒を散らし、演出を強める */
  private tick(tk: Tick, budget: number): void {
    const d = this.d;
    const won = this.won;
    const at = d.presentOffset + tk.at;
    const both = tk.human >= 0 && tk.cpu >= 0;
    if (tk.human >= 0) {
      d.discs.counted(tk.human, at);
      this.countedHuman++;
      d.sfx.countTick('human', tk.index, !both, won);
      this.add(SCORE.disc);
      if (won) {
        d.particles.flipLanded(at, cellX(tk.human), cellY(tk.human), d.human, 'human', tk.index, budget);
        const k = CEREMONY_MOTION.tick.kick;
        d.air.kick(Math.min(1, k.base + this.countedHuman / k.discsForFull));
      }
    }
    if (tk.cpu >= 0) {
      d.discs.counted(tk.cpu, at);
      this.countedCpu++;
      d.sfx.countTick('cpu', tk.index, !both, won);
    }
    d.callout({
      kind: 'tally',
      human: this.countedHuman,
      cpu: this.countedCpu,
      final: tk.index === this.ticks.length - 1,
    });
    d.camera.addTrauma(both ? CEREMONY_MOTION.tick.bothTrauma : CEREMONY_MOTION.tick.trauma);
  }

  /** 負けた側の石を、present の時刻 at から暗くする。引き分けはどちらも暗くしない */
  private dimLoser(at: number): void {
    const outcome = this.result?.outcome;
    const slots = outcome === 'win' ? this.cpuSlots : outcome === 'lose' ? this.humanSlots : null;
    if (!slots) return;
    for (const s of slots) this.d.discs.dim(s, at);
  }

  private verdict(ft: FrameTime, budget: number): void {
    const d = this.d;
    const r = this.result;
    if (!r) return;
    const now = ft.present;
    this.verdictPresent = now;
    d.sfx.verdict(r.outcome, r.perfect);
    d.callout({ kind: 'verdict', outcome: r.outcome, perfect: r.perfect });
    this.dimLoser(now);
    if (r.outcome === 'win') {
      const m = CEREMONY_MOTION;
      const L = LOOK.moments.win;
      d.shockwave(now, CENTER, CENTER, m.win.shockSpeed);
      if (r.perfect) {
        d.shockwave(now + m.perfect.delay, CENTER, CENTER, m.perfect.shockSpeed);
        d.air.prism(L.perfectPrism);
      }
      d.air.flare(ft.real, LOOK.flash * L.flash, r.perfect ? L.perfectBoost : L.boost);
      d.air.spreadRays(L.rays);
      d.air.kick(m.win.kick);
      d.camera.addTrauma(m.win.trauma);
      pull(d.camera, m.win.pull);
      d.vibrate(r.perfect ? HAPTICS.perfect : HAPTICS.win);
      for (const s of this.humanSlots) d.particles.fireworks(now + Math.random() * CEREMONY.fireworksSpread, cellX(s), cellY(s), d.human, budget);
      return;
    }
    if (r.outcome === 'lose') {
      // 負けに明るい光や外へ弾ける粒は出さない。人の石を暗くし、重く沈める
      d.air.darken(LOOK.moments.lose.dark);
      d.camera.addTrauma(CEREMONY_MOTION.lose.trauma);
      pull(d.camera, CEREMONY_MOTION.lose.pull);
      return;
    }
    d.camera.addTrauma(CEREMONY_MOTION.draw.trauma);
  }

  /** 勝ちだけ: 人の石が中心から外へ、波のように跳ね、盤の線を虹色に回す */
  private wave(ft: FrameTime): void {
    const d = this.d;
    if (!this.won) return;
    const now = ft.present;
    for (const s of this.humanSlots) {
      const dist = Math.hypot(cellX(s) - CENTER, cellY(s) - CENTER);
      d.discs.counted(s, now + dist * CEREMONY.waveStep);
    }
    d.shockwave(now, CENTER, CENTER, CEREMONY_MOTION.wave.shockSpeed);
    d.air.prism(LOOK.moments.win.wavePrism);
    pull(d.camera, CEREMONY_MOTION.wave.pull);
  }
}
