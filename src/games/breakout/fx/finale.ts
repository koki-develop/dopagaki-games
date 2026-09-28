import type { CameraRig } from '../../../juice/camera.ts';
import type { FlashLimiter } from '../../../juice/flash.ts';
import type { WorldClock } from '../../../juice/time.ts';
import { BALL_CAP, FIELD_H, FIELD_W } from '../config.ts';
import type { FrameTime } from '../frame-time.ts';
import type { Sim } from '../sim/sim.ts';
import { LOOK } from '../view/look.ts';
import type { Atmosphere } from './atmosphere.ts';
import type { FxState } from './fx-state.ts';
import type { ParticleFx } from './particle-fx.ts';
import type { Shockwave } from './shockwave.ts';
import type { SfxPort, SoundDirector } from './sound-director.ts';

/** 溜めの長さ（秒）。音が鳴っていれば AudioContext の時刻、鳴っていなければ実時間で測る */
export const FINALE_HOLD = 0.3;
/** 溜めの間の世界の時間の倍率。完全には止めず、ごくわずかに動かし続ける */
const FINALE_HOLD_SCALE = 0.03;
/** 溜めのスローモーションから等速へ戻す時間（実時間の秒） */
const FINALE_HOLD_RELEASE = 0.08;
/** 衝撃波の速さ（u / 秒）。フィールドの対角（約 18.4u）を 1.2 秒で渡る */
export const SHOCK_SPEED = 15.5;
/** 炸裂からこの時間（世界時間の秒）で、衝撃波はフィールドのどこにあるボールも通過している */
export const SHOCK_TRAVEL = 1.2;
/** 光の筋がスコアへ届くまでの時間（世界時間の秒）。ばらつかせて、届く音と跳ねを連なりにする */
const FINALE_FLIGHT_MIN = 0.5;
const FINALE_FLIGHT_MAX = 0.8;
/** 最後の光が届いてから、結果画面へ移るまでの余韻（実時間の秒） */
export const FINALE_SETTLE = 0.25;
/** 溜めを音の時計で測るとき、実時間がこれだけ先へ進んだら実時間に従う（秒） */
const HOLD_REAL_GRACE = 0.1;
/** 縁の絞り込みと吸い込みがほどけるまで（実時間の秒） */
const VIGNETTE_RELEASE = 0.35;
/** 1 フレームで光の筋を出すボールの数の上限（品質の倍率を掛ける前）。超えた分も得点には数える */
const MAX_STREAK_FX = 160;
/** 1 フレームで砕ける演出を出す壊れないブロックの数と、そのうち破片も出す数の上限（品質の倍率を掛ける前） */
const MAX_SHATTER_FX = 24;
const MAX_SHATTER_DEBRIS_FX = 12;
/** 溜めの無音から戻すフェード（秒） */
const SILENCE_FADE_IN = 0.005;

export type FinaleAudio = {
  now(): number;
  readonly running: boolean;
  silence(duration: number, fadeIn?: number): { cancel(): void };
};

type FinaleDeps = {
  sim: Sim;
  clock: WorldClock;
  camera: CameraRig;
  audio: FinaleAudio;
  sfx: SfxPort;
  sounds: SoundDirector;
  particles: ParticleFx;
  shockwave: Shockwave;
  flashes: FlashLimiter;
  atmosphere: Atmosphere;
  vibrate(pattern: number | readonly number[]): void;
};

/**
 * フィナーレの段階。
 * - idle: 始まっていない
 * - hold: 溜め。世界をほぼ止め、縁を絞り込み、吸い込む音だけを鳴らす。終わりの瞬間に炸裂する
 * - collect: 衝撃波が通過したボールを光の筋に変え、スコアへ届いたものから得点にする
 * - settle: すべて届いた後の余韻
 * - landed: 解決の和音を鳴らして終わった
 * - skipped: タップで飛ばした。以後は何も鳴らさない
 */
type FinaleStage = 'idle' | 'hold' | 'collect' | 'settle' | 'landed' | 'skipped';

/**
 * ステージクリアのフィナーレ。溜め → 炸裂 → 回収 → 余韻 → 着地（またはスキップ）の順に一方向へだけ進む。
 * 衝撃波の広がり、ボールの回収、壊れないブロックの破砕は、シェーダーの衝撃波の輪と同じ世界時間の式で決める。
 */
export class Finale {
  private readonly d: FinaleDeps;
  private stage: FinaleStage = 'idle';
  private x = 0;
  private y = 0;
  private silenceHandle: { cancel(): void } | null = null;
  /** 溜めを AudioContext の時刻で測るか。溜めの始まりの時刻（その時間軸） */
  private holdOnAudio = false;
  private holdStartAudio = 0;
  private holdStartReal = 0;
  private burst = false;
  /** 炸裂した時刻（実時間・世界時間） */
  private burstReal = 0;
  private burstWorld = 0;
  /** 最後に書いた吸い込みと絞り込み、書いた時刻（実時間）。溜めの途中で飛ばしたとき、ここから戻す */
  private lastInhale = 0;
  private lastVignette = 0;
  private lastWriteReal = 0;
  private skipReal = 0;
  private settledAt = 0;
  /** 光の筋がスコアへ届く時刻（世界時間）。先頭の arrivalCount 個が有効 */
  private readonly arrivals = new Float64Array(BALL_CAP);
  private arrivalCount = 0;
  private collected = 0;
  /** 回収の判定と筋の生成に使う、このフレームの値 */
  private r2 = 0;
  private sweepAll = false;
  private frameWorld = 0;
  private framePresent = 0;
  private streakFx = 0;
  private streakLimit = 0;
  private frameBudget = 1;
  /** このフレームに砕けた壊れないブロックの数と、演出を出した数 */
  private shattered = 0;
  private shatterFx = 0;
  private shatterLimit = 0;
  private shatterDebrisLimit = 0;
  private readonly inShock = (x: number, y: number): boolean => {
    if (this.sweepAll) return true;
    const dx = x - this.x;
    const dy = y - this.y;
    return dx * dx + dy * dy <= this.r2;
  };
  private readonly onCollected = (x: number, y: number): void => {
    const flight = FINALE_FLIGHT_MIN + Math.random() * (FINALE_FLIGHT_MAX - FINALE_FLIGHT_MIN);
    if (this.arrivalCount < this.arrivals.length) this.arrivals[this.arrivalCount++] = this.frameWorld + flight;
    if (this.streakFx++ >= this.streakLimit) return;
    this.d.particles.finaleStreak(this.framePresent, x, y, this.x, this.y, flight);
  };
  private readonly onShattered = (x: number, y: number): void => {
    this.shattered++;
    if (this.shatterFx >= this.shatterLimit) return;
    const aim = Math.atan2(y - this.y, x - this.x);
    this.d.particles.solidShatter(this.framePresent, x, y, aim, this.frameBudget, this.shatterFx < this.shatterDebrisLimit);
    this.shatterFx++;
  };
  private readonly all = (): boolean => true;
  private readonly ignore = (): void => undefined;

  constructor(deps: FinaleDeps) {
    this.d = deps;
  }

  /**
   * 最後のブロックが壊れた位置 (x, y) からフィナーレを始める。
   * 溜めでは時間をほぼ止め、画面の縁が最後のブロックへ向かって絞り込み、ボールと粒が吸い寄せられる。
   * 音は他を消して、吸い込む上昇音だけを鳴らす。
   */
  start(ft: FrameTime, x: number, y: number): void {
    if (this.stage !== 'idle') return;
    const d = this.d;
    this.stage = 'hold';
    this.x = Math.min(FIELD_W, Math.max(0, x));
    this.y = Math.min(FIELD_H, y);
    this.holdStartReal = ft.real;
    this.holdOnAudio = d.audio.running;
    this.holdStartAudio = d.audio.now();
    d.clock.slowMo(FINALE_HOLD_SCALE, FINALE_HOLD, FINALE_HOLD_RELEASE);
    this.silenceHandle = d.audio.silence(FINALE_HOLD, SILENCE_FADE_IN);
    d.sfx.inhale(FINALE_HOLD);
    d.atmosphere.resetRiser();
    d.vibrate([40, 40, 120]);
  }

  /** 1 フレーム進める。結果画面へ移るフレーム（着地）で 1 回だけ true を返す */
  update(ft: FrameTime, budget: number): boolean {
    const s = this.stage;
    if (s === 'hold') {
      const over = this.holdElapsed(ft) - FINALE_HOLD;
      if (over >= 0) this.explode(ft, Math.min(over, ft.realDt), budget);
    }
    if (this.stage === 'collect') this.collect(ft, budget);
    if (this.stage === 'settle' && ft.real - this.settledAt >= FINALE_SETTLE) {
      this.stage = 'landed';
      this.d.sfx.resolveChord();
      this.d.sim.creditClearBonus(Infinity);
      return true;
    }
    return false;
  }

  /**
   * タップで飛ばす。残りのボールとまだ届いていない光をまとめて得点にし、残りの壊れないブロックも音と粒を出さずに取り除く。
   * 飛ばせたら true
   */
  skip(): boolean {
    const s = this.stage;
    if (s !== 'hold' && s !== 'collect' && s !== 'settle') return false;
    const sim = this.d.sim;
    sim.collectBalls(this.all, this.ignore);
    sim.shatterSolids(this.all, this.ignore);
    sim.creditClearBonus(Infinity);
    this.arrivalCount = 0;
    this.cancelSilence();
    this.stage = 'skipped';
    this.skipReal = this.lastWriteReal;
    return true;
  }

  /** 溜めの無音を今すぐやめる（スキップやプレイの破棄） */
  cancelSilence(): void {
    const h = this.silenceHandle;
    this.silenceHandle = null;
    h?.cancel();
  }

  /** 吸い込み・絞り込み・吸い込む点を fx へ書く */
  write(ft: FrameTime, fx: FxState): void {
    let inhale = 0;
    let vignette = 0;
    if (this.stage === 'hold') {
      const k = Math.min(1, this.holdElapsed(ft) / FINALE_HOLD);
      inhale = k * k;
      vignette = 1 - (1 - k) ** 2;
    } else if (this.burst) {
      // 炸裂で外へ押し出して戻る。縁の絞り込みは炸裂とともにほどける
      const r = ft.real - this.burstReal;
      inhale = r < 0.5 ? -0.35 * Math.sin((r / 0.5) * Math.PI) * (1 - r / 0.5) : 0;
      vignette = Math.max(0, 1 - r / VIGNETTE_RELEASE);
    } else if (this.stage === 'skipped') {
      // 溜めの途中で飛ばした。炸裂でほどけるのと同じ速さで、飛ばしたときの値から戻す
      const k = Math.max(0, 1 - (ft.real - this.skipReal) / VIGNETTE_RELEASE);
      inhale = this.lastInhale * k;
      vignette = this.lastVignette * k;
    }
    if (this.stage !== 'skipped') {
      this.lastInhale = inhale;
      this.lastVignette = vignette;
    }
    this.lastWriteReal = ft.real;
    fx.inhale = inhale;
    fx.vignette = vignette;
    fx.focusX = this.stage === 'idle' ? 0 : this.x;
    fx.focusY = this.stage === 'idle' ? 0 : this.y;
  }

  /**
   * 溜めが始まってからの時間。音が鳴っていれば AudioContext の時刻で測り、無音と吸い込む音に炸裂を合わせる。
   * ただし実時間が HOLD_REAL_GRACE 以上先へ進んだら実時間に従う。音の時計が止まったり遅れたりしても、溜めが終わらなくならないように
   */
  private holdElapsed(ft: FrameTime): number {
    const real = ft.real - this.holdStartReal;
    if (!this.holdOnAudio || !this.d.audio.running) return real;
    return Math.max(this.d.audio.now() - this.holdStartAudio, real - HOLD_REAL_GRACE);
  }

  /** 炸裂。over は溜めの終わりから過ぎた時間（実時間の秒） */
  private explode(ft: FrameTime, over: number, budget: number): void {
    const d = this.d;
    this.stage = 'collect';
    this.burst = true;
    this.burstReal = ft.real - over;
    this.burstWorld = ft.world;
    d.shockwave.fire(ft.present, this.x, this.y, SHOCK_SPEED);
    if (d.flashes.request(ft.real)) d.atmosphere.flashTo(LOOK.finaleFlash);
    if (d.flashes.request(ft.real)) d.atmosphere.boostTo(1.4);
    d.sfx.finaleBurst();
    d.camera.addTrauma(0.6);
    d.camera.pull(0.12, 0.12, 0.9);
    d.particles.finaleBurst(ft.present, this.x, this.y, budget);
    d.vibrate(80);
  }

  /**
   * 衝撃波が通過したボールから順に光の筋へ変え、届いた光の数だけ得点にする。
   * 衝撃波が中心を通過した壊れないブロックは砕く
   */
  private collect(ft: FrameTime, budget: number): void {
    const d = this.d;
    const since = ft.world - this.burstWorld;
    const radius = since * SHOCK_SPEED;
    this.r2 = radius * radius;
    this.sweepAll = since >= SHOCK_TRAVEL;
    this.frameWorld = ft.world;
    this.framePresent = ft.present;
    this.frameBudget = budget;
    this.streakFx = 0;
    this.streakLimit = Math.ceil(MAX_STREAK_FX * budget);
    d.sim.collectBalls(this.inShock, this.onCollected);

    this.shattered = 0;
    this.shatterFx = 0;
    this.shatterLimit = Math.ceil(MAX_SHATTER_FX * budget);
    this.shatterDebrisLimit = Math.ceil(MAX_SHATTER_DEBRIS_FX * budget);
    d.sim.shatterSolids(this.inShock, this.onShattered);
    d.sounds.shatter(this.shattered, ft);

    let arrived = 0;
    const a = this.arrivals;
    for (let i = this.arrivalCount - 1; i >= 0; i--) {
      if (a[i] > ft.world) continue;
      a[i] = a[--this.arrivalCount];
      arrived++;
    }
    if (arrived > 0) {
      this.collected += arrived;
      d.sim.creditClearBonus(arrived);
    }
    d.sounds.bonus(arrived, this.collected, ft);

    if (this.sweepAll && this.arrivalCount === 0 && d.sim.balls.count === 0) {
      this.stage = 'settle';
      this.settledAt = ft.real;
    }
  }
}
