import type { ParticleSink } from '../../../engine/particle-spec.ts';
import type { SilenceHandle } from '../../../juice/audio/engine.ts';
import type { CameraRig } from '../../../juice/camera.ts';
import type { FlashLimiter } from '../../../juice/flash.ts';
import type { FrameTime } from '../../../juice/frame-time.ts';
import type { WorldClock } from '../../../juice/time.ts';
import { AFTER_MOVE, AIR, BIG_SILENCE_DELAY, BIG_TIER, flipTier, HAPTICS, hitStopFor, INTRO, MOTION, PASS_PAUSE, SLOW_MO } from '../config.ts';
import type { PullTuning } from '../config.ts';
import { cellX, cellY } from '../geometry.ts';
import type { Bits } from '../rules/bits.ts';
import { BLACK, discAt, emptyCount, isCorner, SQUARES, WHITE } from '../rules/position.ts';
import type { Color, MoveOutcome, Position } from '../rules/position.ts';
import type { MoveScore } from '../scoring.ts';
import { bgmTier } from '../sounds/bgm.ts';
import type { ReversiSfx } from '../sounds/sfx.ts';
import type { NewStable } from '../stable-tracker.ts';
import type { Callout, HudState, RunResult, Side } from '../types.ts';
import { LOOK } from '../view/look.ts';
import { Atmosphere } from './atmosphere.ts';
import type { BgmPort } from './atmosphere.ts';
import { BoardWaves } from './board-waves.ts';
import { Ceremony } from './ceremony.ts';
import type { SilencePort } from './ceremony.ts';
import type { MoveChoreo, PreviewFlip } from './choreo.ts';
import { CueQueue } from './cue-queue.ts';
import { DropKind, LONG_AGO } from './discs.ts';
import type { DiscField } from './discs.ts';
import type { FxState } from './fx-state.ts';
import { ParticleFx } from './particle-fx.ts';
import { PointerFx } from './pointer-fx.ts';
import { ScoreTicker } from './score-ticker.ts';

/** 演出から鳴らす効果音。ReversiSfx がそのまま当てはまる */
export type SfxPort = Pick<
  ReversiSfx,
  | 'swoosh'
  | 'gatherLift'
  | 'vanish'
  | 'place'
  | 'flipStep'
  | 'burst'
  | 'inhale'
  | 'dread'
  | 'corner'
  | 'stable'
  | 'combo'
  | 'comboBreak'
  | 'score'
  | 'newBest'
  | 'pass'
  | 'nope'
  | 'introDrop'
  | 'boardIn'
  | 'countTick'
  | 'verdict'
>;

/** 人の手の、コンボと得点。CPU の手では null */
export type HumanMove = {
  /** この手を数えた後のコンボ（1 以上） */
  combo: number;
  /** 積んだ後のコンボのフィーバーの強さ（0〜1。0 より大きければヒットストップを長くする） */
  fever: number;
  /** この手の点と、この手を足した後の対局中の得点 */
  score: MoveScore;
  total: number;
};

type DirectorPorts = {
  /** 1 回のプレイの効果音（プレイの VoiceGroup に属する） */
  sfx: SfxPort;
  bgm: BgmPort;
  audio: SilencePort;
  /** now は present の時間軸 */
  particles: ParticleSink;
  /** セッションで 1 つ。実時間（FrameTime.real）で問い合わせる */
  flashes: Pick<FlashLimiter, 'request'>;
  vibrate(pattern: number | readonly number[]): void;
  /** 盤の上に文字を出す（位置はワールド座標） */
  callout(c: Callout): void;
};

type DirectorOptions = {
  /** 人の色 */
  human: Color;
  clock: WorldClock;
  camera: CameraRig;
  fx: FxState;
  discs: DiscField;
  ports: DirectorPorts;
  /** これまでの最高スコア（更新の演出の基準。記録がなければ 0） */
  bestScore: number;
  /** world を present へ直す足し算 */
  presentOffset: number;
};

/** 初期配置の 4 石を落とす順（d4 → e5 → e4 → d5） */
const INTRO_ORDER = [27, 36, 28, 35];

const pull = (camera: CameraRig, p: PullTuning): void => camera.pull(p.amount, p.attack, p.release);

/**
 * 1 局の演出。着手の時間割（MoveChoreo）を世界時間の予定（CueQueue）に並べ、時刻が来たフレームで、
 * 石の見た目（DiscField）・音・粒・カメラ・呼び出しの文字を出す。
 * FxState は値のまとまりごとに部品が書く: 画面全体の空気は Atmosphere、波紋と衝撃波は BoardWaves、
 * 指し示しは PointerFx、盤が現れる進み具合と最後に打ったマスはここ。HUD の得点は ScoreTicker が持つ。
 *
 * 時刻の軸: 予定と時間割は world、石と粒と波紋の時刻は present（= presentOffset + world）、
 * 滑らかな変化・フラッシュの制限・思考の見せ方は real、音は鳴らしたフレームの AudioContext の時刻。
 */
export class Director {
  private readonly o: DirectorOptions;
  private readonly atmosphere: Atmosphere;
  private readonly waves: BoardWaves;
  private readonly pointer: PointerFx;
  private readonly particles: ParticleFx;
  private readonly ceremony: Ceremony;
  private readonly ticker: ScoreTicker;
  private readonly cues = new CueQueue<FrameTime>();
  private boardAppearStart = 0;
  private boardAppearing = false;
  private lastX = 0;
  private lastY = 0;
  private lastAt = LONG_AGO;
  /** 大きな手の溜めの無音 */
  private bigSilence: SilenceHandle | null = null;
  /** 着手の通し番号（盤の上の数え上げを手ごとにまとめる） */
  private moveSeq = 0;
  private disposed = false;

  constructor(opts: DirectorOptions) {
    this.o = opts;
    const ports = opts.ports;
    this.atmosphere = new Atmosphere(ports.bgm, ports.flashes);
    this.waves = new BoardWaves(opts.fx);
    this.pointer = new PointerFx({ discs: opts.discs, human: opts.human }, opts.fx);
    this.particles = new ParticleFx(ports.particles);
    this.ticker = new ScoreTicker(opts.bestScore);
    this.ceremony = new Ceremony({
      human: opts.human,
      presentOffset: opts.presentOffset,
      discs: opts.discs,
      sfx: ports.sfx,
      audio: ports.audio,
      air: this.atmosphere,
      camera: opts.camera,
      particles: this.particles,
      shockwave: (at, x, y, speed) => this.waves.shockwave(at, x, y, speed),
      vibrate: (p) => ports.vibrate(p),
      callout: (c) => ports.callout(c),
      addScore: (points) => this.ticker.add(points),
    });
  }

  private present(world: number): number {
    return this.o.presentOffset + world;
  }

  private at(time: number, run: (ft: FrameTime, budget: number) => void): void {
    this.cues.add(time, run);
  }

  // ---- 対局の流れから呼ぶ ----

  /**
   * 対局の始まり: 盤が現れ、始める局面 start の石が 1 つずつ落ちる。stable はその局面の確定石で、落ちた石から光らせる。
   * 演出が終わる世界時間を返す
   */
  intro(start: Position, stable: NewStable, ft: FrameTime): number {
    const t0 = ft.world;
    const discs = this.o.discs;
    discs.clear();
    this.boardAppearStart = t0;
    this.boardAppearing = true;
    this.o.ports.sfx.boardIn();
    const order: number[] = [];
    for (let s = 0; s < SQUARES; s++) if (discAt(start, s) !== -1) order.push(s);
    // 初期配置の 4 石は、対角の順（d4 → e5 → e4 → d5）に落とす
    if (order.length === 4) order.sort((a, b) => INTRO_ORDER.indexOf(a) - INTRO_ORDER.indexOf(b));
    const interval = Math.min(INTRO.discInterval, INTRO.maxSpread / order.length);
    const stableSet = new Set([...stable.black, ...stable.white]);
    order.forEach((s, i) => {
      const c = discAt(start, s) as Color;
      const dropAt = t0 + INTRO.firstDisc + i * interval;
      discs.drop(s, c, this.present(dropAt), INTRO.drop, DropKind.Intro);
      this.at(dropAt + INTRO.drop, (f) => {
        discs.landed(s, c);
        if (stableSet.has(s)) discs.stable(s, f.present);
        this.o.ports.sfx.introDrop(i);
        this.waves.ripple(f.present, cellX(s), cellY(s), MOTION.introDrop.ripple);
        this.o.camera.addTrauma(MOTION.introDrop.trauma);
      });
    });
    this.updateProgress(start);
    return t0 + INTRO.firstDisc + Math.max(0, order.length - 1) * interval + INTRO.drop + INTRO.settle;
  }

  /**
   * 着手の演出を始める。stable はこの手で新しく確定石になったマス、human は人の手のコンボと得点（CPU の手では null）。
   * 演出が終わる世界時間を返す
   */
  move(outcome: MoveOutcome, c: MoveChoreo, stable: NewStable, ft: FrameTime, human: HumanMove | null): number {
    const t0 = ft.world;
    const discs = this.o.discs;
    const side = c.mover;
    const color = outcome.color;
    const x = cellX(c.square);
    const y = cellY(c.square);
    const from: Color = color === BLACK ? WHITE : BLACK;
    this.pointer.clearPointer(ft.present);
    discs.clearLegal(this.present(t0));
    discs.drop(c.square, color, this.present(t0), c.landAt, side === 'human' ? DropKind.Human : DropKind.Cpu);
    for (const f of c.flips) discs.flip(f.square, from, color, this.present(t0 + f.start), f.duration, f.spins, f.lift, f.dirX, f.dirY);
    const corner = isCorner(c.square);
    const tier = c.tier;
    if (human) this.o.ports.sfx.swoosh(c.landAt, tier);
    const hitStop = human && tier >= 1 ? hitStopFor(c.count, human.fever > 0) : 0;

    this.at(t0 + c.landAt, (f, budget) => this.landed(f, budget, c, human, hitStop, corner, x, y));
    this.at(t0 + c.waveAt, (f, budget) => this.waveStarted(f, budget, c, human !== null, x, y));

    // 返りきる（同じ時刻のまとまりごとに音を 1 つ）。人の手で段階 1 以上なら、返った枚数を数え上げる
    const moveId = ++this.moveSeq;
    let landedCount = 0;
    for (const step of c.steps) {
      this.at(t0 + step.time, (f, budget) => {
        this.o.ports.sfx.flipStep(side, step.index, step.count, tier);
        landedCount += step.count;
        if (side === 'human' && tier >= 1) {
          this.o.ports.callout({ kind: 'flips', move: moveId, count: landedCount, level: flipTier(landedCount), final: landedCount === c.count, x, y });
        }
        for (const fl of c.flips) {
          if (Math.abs(fl.start + fl.duration - step.time) > 1e-9) continue;
          discs.landed(fl.square, color);
          this.particles.flipLanded(f.present, cellX(fl.square), cellY(fl.square), color, side, fl.order, budget);
        }
        if (side === 'human') {
          const m = MOTION.flipLand.human;
          this.o.camera.addTrauma(m.trauma.base + m.trauma.perTier * tier);
          this.atmosphere.kick(Math.min(1, m.kick.base + (step.index + 1) / m.kick.stepsForFull));
        } else {
          this.o.camera.addTrauma(MOTION.flipLand.cpu.trauma);
        }
      });
    }

    // 返りきった後: 確定石、得点、最高スコアの更新。次の手番はこれを待たない（最後の手だけは、出しきってから終局の儀式へ）
    const after = t0 + c.lastLandAt;
    this.at(after + AFTER_MOVE.stable, (f, budget) => this.markStable(stable, f, budget));
    const lastNotice = human ? this.afterHumanMove(human, moveId, x, y, after) : after;

    this.updateProgress(outcome.position);
    return outcome.over ? Math.max(t0 + c.end, lastNotice + AFTER_MOVE.settle) : t0 + c.end;
  }

  /** コンボが途切れた */
  comboBroken(): void {
    this.o.ports.sfx.comboBreak();
  }

  /** フィーバーの強さ（0〜1）。光をビートに乗せ、BGM の段階を上げる */
  setFever(level: number): void {
    this.atmosphere.setFever(level);
  }

  /** パスした。演出が終わる世界時間を返す */
  pass(who: Side, ft: FrameTime): number {
    this.o.ports.sfx.pass(who);
    this.o.ports.callout({ kind: 'pass', who });
    this.o.camera.addTrauma(MOTION.pass[who]);
    return ft.world + PASS_PAUSE;
  }

  /** 次に打つ側。盤と背景の色をその側へ寄せる */
  setTurn(side: Side): void {
    this.atmosphere.setTurn(side);
  }

  /** 人が打てるマスの印を、集合 legal のマスに出す（空の集合なら印を消す） */
  showLegal(legal: Readonly<Bits>, ft: FrameTime): void {
    this.o.discs.setLegal(legal, ft.present);
  }

  /** 押している・ホバーしているマス。legal なら半透明の石を置き、返る石を震わせる（flips）。square が -1 なら消す */
  setPointer(square: number, legal: boolean, flips: readonly PreviewFlip[], ft: FrameTime): void {
    this.pointer.setPointer(square, legal, flips, ft.present);
  }

  /** 人が打てないマスを選んだ。鈍い音で知らせる */
  rejected(): void {
    this.o.ports.sfx.nope();
    this.o.camera.addTrauma(MOTION.rejected.trauma);
  }

  /** キーボードのカーソルのマス（-1 は出さない） */
  setCursor(square: number): void {
    this.pointer.setCursor(square);
  }

  /** 終局の儀式を始める */
  ending(result: RunResult, ft: FrameTime): void {
    this.atmosphere.setFever(0);
    this.ceremony.start(ft, result);
  }

  /** 終局の儀式をタップで飛ばす。飛ばせたら true */
  skip(): boolean {
    return this.ceremony.skip();
  }

  /** 捨てる。予定を捨て、かけている無音を解く */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cues.clear();
    this.bigSilence?.cancel();
    this.bigSilence = null;
    this.ceremony.stopHush();
  }

  // ---- フレーム ----

  /** 1 フレーム進める。終局の儀式が終わったフレームで 1 回だけ true を返す */
  frame(ft: FrameTime, budget: number): boolean {
    if (this.disposed) return false;
    this.cues.runDue(ft.world, ft, budget);
    const done = this.ceremony.update(ft, budget);

    const fx = this.o.fx;
    this.atmosphere.update(ft, fx);
    this.pointer.update(ft, fx);
    this.o.camera.update(ft.worldDt);
    fx.boardAppear = this.boardAppearing ? Math.min(1, (ft.world - this.boardAppearStart) / INTRO.board) : 1;
    if (fx.boardAppear >= 1) this.boardAppearing = false;
    fx.lastX = this.lastX;
    fx.lastY = this.lastY;
    fx.lastAt = this.lastAt;
    return done;
  }

  hud(out: HudState): void {
    const human = this.o.human;
    if (this.ceremony.started) {
      const h = this.ceremony.countedHuman;
      const c = this.ceremony.countedCpu;
      out.black = human === BLACK ? h : c;
      out.white = human === BLACK ? c : h;
    } else {
      out.black = this.o.discs.countShown(BLACK);
      out.white = this.o.discs.countShown(WHITE);
    }
    out.score = this.ticker.shown;
    out.newBest = this.ticker.newBest;
  }

  // ---- 内部 ----

  /** 石が着いた。人の手は打撃・コンボ・ヒットストップ・大きな手の溜め、CPU の手は重い着地と暗さ。角ならその演出も重ねる */
  private landed(f: FrameTime, budget: number, c: MoveChoreo, human: HumanMove | null, hitStop: number, corner: boolean, x: number, y: number): void {
    const discs = this.o.discs;
    const cam = this.o.camera;
    const sfx = this.o.ports.sfx;
    const tier = c.tier;
    discs.landed(c.square, c.color);
    this.lastX = x;
    this.lastY = y;
    this.lastAt = f.present;
    if (human) {
      const m = MOTION.humanLand;
      sfx.place('human', tier);
      sfx.combo(human.combo);
      if (human.combo >= 2) this.o.ports.callout({ kind: 'combo', count: human.combo, x, y });
      this.particles.impact(f.present, x, y, c.color, 'human', tier, budget);
      cam.addTrauma(m.trauma.base + m.trauma.perTier * tier);
      cam.punch(m.punch.base + m.punch.perTier * tier, m.punch.attack, m.punch.release);
      this.waves.ripple(f.present, x, y, m.ripple.base + m.ripple.perTier * tier);
      this.atmosphere.kick(Math.min(1, m.kick.base + c.count / m.kick.flipsForFull));
      // 1 回の光: ヒットストップの閃光と、角の bloom
      const hitFlash = hitStop > 0 ? LOOK.flash * (LOOK.moments.hitFlash.base + LOOK.moments.hitFlash.perTier * tier) : 0;
      this.atmosphere.flare(f.real, hitFlash, corner ? LOOK.moments.corner.boost : 0);
      if (hitStop > 0) this.hitStop(f, x, y, tier, hitStop);
      if (tier >= BIG_TIER) {
        // 着いた音の立ち上がりを聞かせてから、ヒットストップと返り始めるまでの溜めの間を無音にし、吸い込む音だけを鳴らす
        const hold = hitStop + (c.waveAt - c.landAt) - BIG_SILENCE_DELAY;
        this.bigSilence = this.o.ports.audio.silence(hold, 0.005, BIG_SILENCE_DELAY);
        sfx.inhale(BIG_SILENCE_DELAY + hold);
        const b = MOTION.bigHold;
        cam.pull(b.amount.base + b.amount.perTier * (tier - BIG_TIER), b.attack, b.release);
      }
      if (corner) this.humanCorner(f, x, y, budget);
      return;
    }
    const m = MOTION.cpuLand;
    const weight = Math.min(1, c.count / m.weightFlips);
    const dark = LOOK.moments.cpuLand.dark;
    sfx.place('cpu', flipTier(c.count));
    this.particles.impact(f.present, x, y, c.color, 'cpu', 0, budget);
    cam.addTrauma(m.trauma.base + m.trauma.perWeight * weight);
    this.waves.ripple(f.present, x, y, m.ripple.base + m.ripple.perWeight * weight);
    this.atmosphere.darken(dark.base + dark.perWeight * weight);
    if (corner) {
      this.atmosphere.darken(LOOK.moments.corner.cpuDark);
      cam.addTrauma(MOTION.corner.cpu.trauma);
    }
  }

  /** 返り始めた。段階 2 以上の人の手は低音と光の筋、大きな手はスローモーションと衝撃波。CPU が多く返した手は暗くする */
  private waveStarted(f: FrameTime, budget: number, c: MoveChoreo, byHuman: boolean, x: number, y: number): void {
    const tier = c.tier;
    if (byHuman) {
      if (tier < 2) return;
      const L = LOOK.moments;
      const big = tier >= BIG_TIER;
      const top = tier >= 4;
      this.o.ports.sfx.burst(tier);
      this.particles.burst(f.present, x, y, c.color, tier, budget);
      this.atmosphere.spreadRays(L.wave.rays.base + L.wave.rays.perTier * tier);
      this.o.camera.addTrauma(MOTION.wave.trauma.base + MOTION.wave.trauma.perTier * tier);
      // 1 回の光: 大きな手の閃光と、bloom
      const flash = big ? LOOK.flash * (top ? L.bigFlash.top : L.bigFlash.big) : 0;
      this.atmosphere.flare(f.real, flash, L.wave.boost.base + L.wave.boost.perTier * tier);
      if (!big) return;
      const m = MOTION.bigWave;
      this.o.clock.slowMoWorld(top ? SLOW_MO.scale.top : SLOW_MO.scale.big, (c.lastLandAt - c.waveAt) * SLOW_MO.cover, SLOW_MO.release);
      this.o.camera.pull(m.amount.base + m.amount.perTier * (tier - BIG_TIER), m.attack, m.release);
      this.waves.shockwave(f.present, x, y, m.shockSpeed.base + m.shockSpeed.perTier * tier);
      this.o.ports.vibrate(top ? HAPTICS.top : HAPTICS.big);
      if (top) this.atmosphere.prism(L.topPrism);
      return;
    }
    const m = MOTION.cpuWave;
    if (c.count < m.minFlips) return;
    const dark = LOOK.moments.cpuWave.dark;
    this.o.ports.sfx.dread(Math.min(1, c.count / m.weightFlips));
    this.atmosphere.darken(dark.base + Math.min(dark.max, c.count * dark.perFlip));
    this.o.camera.addTrauma(m.trauma);
  }

  /** 人が角を取った（光は着いたときの 1 回の光に含める） */
  private humanCorner(f: FrameTime, x: number, y: number, budget: number): void {
    const m = MOTION.corner.human;
    this.o.ports.sfx.corner();
    this.o.ports.callout({ kind: 'corner', x, y });
    this.particles.corner(f.present, x, y, budget);
    this.o.camera.addTrauma(m.trauma);
    pull(this.o.camera, m.pull);
    this.o.ports.vibrate(HAPTICS.corner);
  }

  /** 新しく確定石になった石を光らせる。人の石が確定したら音を鳴らす */
  private markStable(stable: NewStable, f: FrameTime, budget: number): void {
    const human = this.o.human === BLACK ? stable.black : stable.white;
    for (const s of stable.black) this.o.discs.stable(s, f.present);
    for (const s of stable.white) this.o.discs.stable(s, f.present);
    for (const s of human) this.particles.sparkle(f.present, cellX(s), cellY(s), budget);
    if (human.length > 0) this.o.ports.sfx.stable(human.length);
  }

  /**
   * ヒットストップ: duration 秒（実時間）世界の時間を止め、止めた石を震わせ、集中線と RGB のずれを出す。振動も重ねる。
   * 長さは返した枚数とフィーバーから決める（config.ts の hitStopFor）
   */
  private hitStop(f: FrameTime, x: number, y: number, tier: number, duration: number): void {
    const amp = AIR.hitAmp.base + AIR.hitAmp.perTier * tier;
    this.o.clock.hitStop(duration);
    this.atmosphere.hitStop(x, y, amp, duration, f.real);
    this.o.ports.vibrate(HAPTICS.hitStop.base + HAPTICS.hitStop.perTier * tier);
  }

  /**
   * 人の手が返りきった後の知らせを予定に並べる。得点は必ず、最高スコアの更新は起きたときだけ。
   * 最後の知らせの世界時間を返す
   */
  private afterHumanMove(human: HumanMove, moveId: number, x: number, y: number, after: number): number {
    let last = after + AFTER_MOVE.score;
    const score = human.score;
    this.at(after + AFTER_MOVE.score, (f, budget) => {
      this.ticker.add(score.total);
      const quick = score.quick > 0;
      this.o.ports.sfx.score(score.multiplier, quick);
      this.o.ports.callout({ kind: 'score', move: moveId, points: score.total, multiplier: score.multiplier, quick, x, y });
      this.particles.sparkle(f.present, x, y, budget);
    });
    // 対局中の得点は、この手の点を足した値で比べる（手の点は表示の前に確定している）
    if (this.ticker.crosses(human.total)) {
      last = after + AFTER_MOVE.best;
      this.at(last, (f) => this.newBest(f));
    }
    return last;
  }

  /** 対局中の得点が、これまでの最高スコアを超えた: 駆け上がる和音、光、カメラの引き */
  private newBest(f: FrameTime): void {
    const L = LOOK.moments.newBest;
    this.ticker.celebrate();
    this.o.ports.sfx.newBest();
    this.atmosphere.spreadRays(L.rays);
    this.atmosphere.prism(L.prism);
    this.atmosphere.flare(f.real, 0, L.boost);
    pull(this.o.camera, MOTION.newBest.pull);
    this.o.camera.addTrauma(MOTION.newBest.trauma);
    this.o.ports.vibrate(HAPTICS.newBest);
  }

  /** 盤に置かれた石の数と空きマスから、BGM の段階と終盤の高まりを決める */
  private updateProgress(p: Position): void {
    const empties = emptyCount(p);
    this.atmosphere.setProgress(bgmTier(SQUARES - empties), empties);
  }
}
