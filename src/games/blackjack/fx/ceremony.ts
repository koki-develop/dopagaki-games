import type { SilenceHandle, SoundHandle } from '../../../juice/audio/engine.ts';
import type { FrameTime } from '../../../juice/frame-time.ts';
import { CEREMONY, CEREMONY_MOTION, HAPTICS } from '../config.ts';
import type { PullTuning } from '../config.ts';
import { TABLE_H, TABLE_W } from '../geometry.ts';
import type { Callout, Outcome, RunResult } from '../types.ts';
import { LOOK } from '../view/look.ts';

/** 儀式から鳴らす音 */
type CeremonySfx = {
  drumRoll(duration: number): SoundHandle;
  verdict(outcome: Outcome): void;
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
};

type CeremonyDeps = {
  sfx: CeremonySfx;
  audio: SilencePort;
  air: CeremonyAir;
  camera: { addTrauma(amount: number): void; pull(amount: number, attack: number, release: number): void };
  particles: { fireworks(now: number, x: number, y: number, budget: number): void };
  /** 衝撃波を放つ（present の時刻、中心、速さ） */
  shockwave(at: number, x: number, y: number, speed: number): void;
  vibrate(pattern: number | readonly number[]): void;
  callout(c: Extract<Callout, { kind: 'verdict' }>): void;
  /** 最高スコアの更新の演出（記録を超え、増やして終えたときだけ、決着の後に呼ぶ） */
  newBest(ft: FrameTime): void;
  /** 更新の演出を出さずに HUD の BEST だけを付ける（飛ばしたときと、記録を超えたが減らして終えたとき） */
  bestShown(): void;
};

/** 花火の数 */
const FIREWORKS = 10;
const CENTER_X = TABLE_W / 2;
const CENTER_Y = TABLE_H / 2;

const pull = (camera: CeremonyDeps['camera'], p: PullTuning): void => camera.pull(p.amount, p.attack, p.release);

/**
 * 終わりの儀式。場を片付けた卓で（最後の手持ちは HUD の数と手持ちの山にずっと出ているので、数え直さない）、
 * 1. ほかの音を消して溜め（増やしたときはドラムロールを鳴らす）、決着（増やした・同じ・減らした・破産）と始めからの増減を叩きつける。
 *    増やしたときは衝撃波・花火・明るい和音、減らしたときは暗くして低い和音
 * 2. 最後の手持ちが記録のある最高スコアを超えていたら、決着の後に更新を知らせる。増やして終えたときだけ祝い、
 *    減らして終えたとき（前の記録が始めの手持ちより低かった）は HUD に BEST を付けるだけにする
 * 溜めのドラムロール・外へ弾ける粒・光は増やしたときだけに付け、それ以外には付けない。
 * タップで飛ばせる。飛ばしても結果は変わらない。
 */
export class Ceremony {
  private readonly d: CeremonyDeps;
  private result: RunResult | null = null;
  private hushAt = Infinity;
  private verdictAt = Infinity;
  private finishAt = Infinity;
  private hushDone = false;
  private verdictDone = false;
  private bestAt = Infinity;
  private bestDone = false;
  private finished = false;
  private silenceHandle: SilenceHandle | null = null;
  private rollHandle: SoundHandle | null = null;

  constructor(deps: CeremonyDeps) {
    this.d = deps;
  }

  get started(): boolean {
    return this.result !== null;
  }

  private get profit(): boolean {
    return this.result?.outcome === 'profit';
  }

  /** 儀式を始める（世界時間 ft.world から） */
  start(ft: FrameTime, result: RunResult): void {
    if (this.result) return;
    this.result = result;
    this.hushAt = ft.world + CEREMONY.lead;
    this.verdictAt = this.hushAt + CEREMONY.hush;
    this.finishAt = this.verdictAt + (result.outcome === 'profit' ? CEREMONY.settleProfit : CEREMONY.settleOther);
    if (result.newBest) this.bestAt = this.verdictAt + CEREMONY.newBestAfter;
    pull(this.d.camera, CEREMONY_MOTION.start.pull);
  }

  /** 1 フレーム進める。結果画面へ移るフレームで 1 回だけ true */
  update(ft: FrameTime, budget: number): boolean {
    const r = this.result;
    if (!r || this.finished) return false;
    const d = this.d;
    const w = ft.world;
    if (!this.hushDone && w >= this.hushAt) {
      this.hushDone = true;
      this.silenceHandle = d.audio.silence(CEREMONY.hush, 0.01);
      if (this.profit) this.rollHandle = d.sfx.drumRoll(CEREMONY.hush);
    }
    if (!this.verdictDone && w >= this.verdictAt) {
      this.verdictDone = true;
      this.verdict(ft, budget);
    }
    if (!this.bestDone && w >= this.bestAt) {
      this.bestDone = true;
      // 減らして終えた（前の記録が始めの手持ちより低かった）ときは祝わず、HUD に BEST を付けるだけにする
      if (this.profit) d.newBest(ft);
      else d.bestShown();
    }
    if (w >= this.finishAt) {
      this.finished = true;
      return true;
    }
    return false;
  }

  /** タップで飛ばす。決着の文字を出して、すぐに結果へ進む。飛ばせたら true */
  skip(): boolean {
    const r = this.result;
    if (!r || this.finished) return false;
    this.stopHush();
    if (!this.verdictDone) this.d.callout({ kind: 'verdict', outcome: r.outcome, net: r.score.total - r.score.start });
    if (r.newBest && !this.bestDone) this.d.bestShown();
    this.finished = true;
    return true;
  }

  /** 溜めの無音とドラムロールを今すぐやめる（スキップやプレイの破棄） */
  stopHush(): void {
    const silence = this.silenceHandle;
    const roll = this.rollHandle;
    this.silenceHandle = null;
    this.rollHandle = null;
    silence?.cancel();
    roll?.stop();
  }

  private verdict(ft: FrameTime, budget: number): void {
    const d = this.d;
    const r = this.result;
    if (!r) return;
    const now = ft.present;
    d.sfx.verdict(r.outcome);
    d.callout({ kind: 'verdict', outcome: r.outcome, net: r.score.total - r.score.start });
    if (r.outcome === 'profit') {
      const m = CEREMONY_MOTION.profit;
      const L = LOOK.moments.profit;
      d.shockwave(now, CENTER_X, CENTER_Y, m.shockSpeed);
      d.air.flare(ft.real, LOOK.flash * L.flash, L.boost);
      d.air.spreadRays(L.rays);
      d.air.prism(L.prism);
      d.air.kick(m.kick);
      d.camera.addTrauma(m.trauma);
      pull(d.camera, m.pull);
      d.vibrate(HAPTICS.profit);
      for (let i = 0; i < FIREWORKS; i++) {
        d.particles.fireworks(now + Math.random() * CEREMONY.fireworksSpread, 1 + Math.random() * (TABLE_W - 2), 2 + Math.random() * (TABLE_H - 4), budget);
      }
      return;
    }
    if (r.outcome === 'even') {
      d.camera.addTrauma(CEREMONY_MOTION.even.trauma);
      return;
    }
    // 減らして終えたときは、明るい光や外へ弾ける粒を出さない。暗くして重く沈める
    d.air.darken(LOOK.moments.lossEnd.dark);
    d.camera.addTrauma(CEREMONY_MOTION.loss.trauma);
    pull(d.camera, CEREMONY_MOTION.loss.pull);
  }
}
