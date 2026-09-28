import type { CameraRig } from '../../../juice/camera.ts';
import type { FlashLimiter } from '../../../juice/flash.ts';
import type { WorldClock } from '../../../juice/time.ts';
import { FIELD_H, FIELD_W, STEP_DT } from '../config.ts';
import type { FrameTime } from '../frame-time.ts';
import { EventKind, Signal } from '../sim/events.ts';
import type { Sim } from '../sim/sim.ts';
import type { HudState } from '../types.ts';
import { FrameSummary, FxFlag, summarize } from './aggregate.ts';
import { Atmosphere } from './atmosphere.ts';
import type { BgmPort } from './atmosphere.ts';
import { Finale } from './finale.ts';
import type { FinaleAudio } from './finale.ts';
import type { FxState } from './fx-state.ts';
import { createWallHits, WALL_HIT_SLOTS } from './fx-state.ts';
import { GameOver } from './game-over.ts';
import { IntensityMeter } from './intensity.ts';
import { NEW_BEST_PEAK_LEVEL, NewBest, playPeak } from './peak.ts';
import type { PeakDeps } from './peak.ts';
import { ParticleFx } from './particle-fx.ts';
import type { DebrisSink, ParticleSink } from './particle-fx.ts';
import { SoundDirector } from './sound-director.ts';
import type { SfxPort } from './sound-director.ts';
import { TierTracker } from './tiers.ts';

/**
 * 実時間（FrameTime.real）の軸で「十分に過去」を表す時刻。パドルに当たった時刻の初期値にして、squash と光を出さない。
 * CPU の倍精度で exp(-経過時間 × 14) を計算するだけなので、確実に 0 になる大きさにする
 */
const REAL_LONG_AGO = -1e9;

/** 奈落に落ちたボールを描く先。時刻 at（present の時間軸）に位置 (x, y) にあり、速度 (vx, vy) で進む */
export type FallenBallSink = { emit(at: number, x: number, y: number, vx: number, vy: number): void };

export type DirectorPorts = {
  /** 1 回のプレイの効果音（プレイの VoiceGroup に属する） */
  sfx: SfxPort;
  bgm: BgmPort;
  audio: FinaleAudio;
  /** now は present の時間軸 */
  particles: ParticleSink;
  debris: DebrisSink;
  fallenBalls: FallenBallSink;
  /** セッションで 1 つ。実時間（FrameTime.real）で問い合わせる */
  flashes: FlashLimiter;
  vibrate(pattern: number | readonly number[]): void;
};

type DirectorOptions = {
  /** 読むだけに使う。書き換えるのは決着した後のボールの回収、壊れないブロックの破砕、ボールボーナスの加算だけ */
  sim: Sim;
  clock: WorldClock;
  camera: CameraRig;
  /** 毎フレーム endless 以外のすべての値を書く */
  fx: FxState;
  ports: DirectorPorts;
  previousBest: number;
  /** sim の phase が playing でなくなったフレームで 1 回だけ */
  onEnding(): void;
  /** 結果画面を出すときに 1 回だけ（フィナーレの着地・スキップ、ゲームオーバーから 1.4 秒） */
  onFinished(outcome: DirectorOutcome): void;
};

/** プレイの結果。score はボールボーナスを加えた最終スコア、newBest は前のベストを超えたか */
export type DirectorOutcome = { cleared: boolean; score: number; newBest: boolean };

/**
 * 演出のライフサイクル。
 * - live: プレイ中
 * - ending: 勝敗が決まり、結果画面までの演出の間。大量に起きる音は鳴らさない
 * - afterglow: 結果画面を出した後。結果画面の後ろで世界は動き続けるが、音は鳴らさない
 */
type DirectorLifecycle = 'live' | 'ending' | 'afterglow';

/** HUD の値のうち、演出ディレクターが毎フレーム書くもの */
type DirectorHud = Omit<HudState, 'runId' | 'maxLives'>;

/**
 * sim のイベントを演出（音・パーティクル・破片・カメラ・背景・Peak・フィナーレ）へ変換する。1 回のプレイごとに作る。
 * 大量に起きるイベントはフレーム単位で集計してから演出にする。
 * 時刻は FrameTime の軸を使い分ける: 粒と FxState の時刻は present、衝撃波と光の到着は world、
 * 滑らかな変化とフラッシュリミッターは real、音の予約は AudioContext の時刻。
 */
export class Director {
  private readonly sim: Sim;
  private readonly camera: CameraRig;
  private readonly fx: FxState;
  private readonly ports: DirectorPorts;
  private readonly onEnding: () => void;
  private readonly onFinished: (outcome: DirectorOutcome) => void;

  private readonly summary = new FrameSummary();
  private readonly meter = new IntensityMeter();
  private readonly tiers = new TierTracker();
  private readonly particles: ParticleFx;
  private readonly sounds: SoundDirector;
  private readonly atmosphere: Atmosphere;
  private readonly newBest: NewBest;
  private readonly peakDeps: PeakDeps;
  private readonly finale: Finale;
  private readonly gameOver: GameOver;

  private readonly previousBest: number;
  private state: DirectorLifecycle = 'live';
  private disposed = false;
  /** 壁に当たった記録（FxState.wallHits と同じ並び）。毎フレーム FxState へ写す */
  private readonly wallHits = createWallHits();
  private wallSlot = 0;
  private paddleHitAt = REAL_LONG_AGO;
  private paddleHitStrength = 0;

  constructor(opts: DirectorOptions) {
    const { sim, ports } = opts;
    this.sim = sim;
    this.camera = opts.camera;
    this.fx = opts.fx;
    this.ports = ports;
    this.onEnding = opts.onEnding;
    this.onFinished = opts.onFinished;
    this.previousBest = opts.previousBest;
    this.particles = new ParticleFx(ports.particles, ports.debris);
    this.sounds = new SoundDirector(ports.sfx);
    this.atmosphere = new Atmosphere(ports.bgm, sim.blocks.breakableCount);
    this.newBest = new NewBest(opts.previousBest);
    const vibrate = (pattern: number | readonly number[]): void => ports.vibrate(pattern);
    this.peakDeps = { camera: opts.camera, sfx: ports.sfx, flashes: ports.flashes, atmosphere: this.atmosphere, vibrate };
    this.finale = new Finale({
      sim,
      clock: opts.clock,
      camera: opts.camera,
      audio: ports.audio,
      sfx: ports.sfx,
      sounds: this.sounds,
      particles: this.particles,
      flashes: ports.flashes,
      atmosphere: this.atmosphere,
      vibrate,
    });
    this.gameOver = new GameOver({
      sim,
      clock: opts.clock,
      camera: opts.camera,
      sfx: ports.sfx,
      bgm: ports.bgm,
      atmosphere: this.atmosphere,
      particles: this.particles,
    });
  }

  /** HUD のスコアの位置（ワールド座標）。得点に変わった光が吸い込まれる先 */
  setScoreAnchor(x: number, y: number): void {
    this.particles.setAnchor(x, y);
  }

  hud(out: DirectorHud): void {
    const s = this.sim;
    out.score = s.score;
    out.chain = s.chain;
    out.multiplier = s.chainMultiplier;
    out.best = Math.max(this.previousBest, s.score);
    out.newBest = this.newBest.isNewBest(s.score);
    out.lives = s.lives;
  }

  /**
   * ステージクリアのフィナーレをタップで飛ばす。残りのボールボーナスをまとめて加算し、すぐに結果へ進む。
   * 飛ばせたら true。ゲームオーバーの演出とプレイ中は飛ばせない。
   */
  skip(): boolean {
    if (this.disposed || this.state !== 'ending') return false;
    if (!this.finale.skip()) return false;
    this.finish(true);
    return true;
  }

  /** プレイを捨てる。溜めの無音を解き、以後は何もしない。何度呼んでもよい */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.finale.cancelSilence();
  }

  /**
   * 1 フレーム分の演出を進める。このフレームの sim のステップを進めた後に呼ぶ（イベントは読むだけで消さない）。
   * budget はパーティクルの品質の倍率（0〜1）。
   */
  frame(ft: FrameTime, budget: number): void {
    if (this.disposed) return;
    const { sim, camera, particles, ports } = this;
    const ev = sim.events;
    const s = summarize(ev, budget, this.summary);
    const now = ft.present;
    const hue = this.atmosphere.hue;

    // --- 個々のイベントの粒と壁の揺れ（発生した順） ---
    for (let k = 0; k < s.length; k++) {
      const i = s.index[k];
      const flags = s.flags[k];
      const x = ev.x[i];
      const y = ev.y[i];
      if (flags & FxFlag.Mega) particles.megaBurst(now, x, y, hue, budget);
      if (flags & FxFlag.Break) particles.blockBreak(now, x, y, ev.a[i], budget, (flags & FxFlag.Debris) !== 0);
      if (flags & FxFlag.HardSpark) particles.hardSparks(now, x, y, budget);
      if (flags & FxFlag.SolidSpark) particles.solidSparks(now, x, y, ev.a[i], ev.b[i], budget);
      if (flags & FxFlag.PaddleSpark) particles.paddleSparks(now, x, y, hue, budget);
      if (flags & FxFlag.Wall) this.wallHit(now, y, ev.a[i], s.wallCount);
      if (flags & FxFlag.Overflow) particles.overflowStreak(now, x, y);
    }

    // --- 奈落に落ちたボール ---
    // ボールは 1 つ前と今の固定ステップの間を補間して描くので、描く位置は sim の時刻より 1 ステップ遅れる。
    // 生きていたときの描き方とつながるよう、イベントの時刻の位置を 1 ステップ後の present の時刻に置く
    const fallenAt = ft.present - ft.world + STEP_DT;
    for (let i = 0; i < ev.length; i++) {
      if (ev.kind[i] === EventKind.Drain) ports.fallenBalls.emit(fallenAt + ev.t[i], ev.x[i], ev.y[i], ev.a[i], ev.b[i]);
    }

    // --- 強さと段階 ---
    this.meter.update(s.breaks, sim.chain, ft.worldDt);
    if (sim.phase === 'playing') this.tiers.update(sim.ballCount);

    // --- 音とパドル ---
    this.sounds.frame(s, this.meter, ft);
    if (s.paddleCount > 0) {
      this.paddleHitAt = ft.real;
      this.paddleHitStrength = Math.min(1, 0.55 + Math.abs(s.paddleT) * 0.3 + (s.paddleCount - 1) * 0.1);
    }

    // --- カメラ ---
    if (s.breaks > 0) camera.addTrauma(0.03 * Math.log(1 + s.breaks) * (1 + this.meter.intensity));
    if (s.megaCount > 0) camera.addTrauma(0.3);

    // --- 状態遷移 ---
    const signals = s.signals;
    if (signals & (Signal.BallsZero | Signal.LifeLost)) {
      ports.sfx.ballsZero();
      camera.addTrauma(0.5);
      ports.vibrate([30, 40, 60]);
    }
    if (signals & Signal.StepLanded) {
      ports.sfx.stepThud();
      camera.addTrauma(0.07);
    }
    if (signals & Signal.PenaltyLanded) {
      ports.sfx.slam();
      camera.addTrauma(0.25);
      const y = sim.blocks.lowestLiveBlockBottom();
      if (Number.isFinite(y)) particles.slamDust(now, y);
    }
    if (this.state === 'live' && sim.phase !== 'playing') this.beginEnding(ft, budget, signals);

    if (this.newBest.check(sim.score, sim.phase === 'playing')) playPeak(NEW_BEST_PEAK_LEVEL, ft.real, this.peakDeps);

    if (this.finale.update(ft, budget)) this.finish(true);
    if (this.gameOver.update(ft)) this.finish(false);

    // --- 背景・色・bloom・パドル ---
    const fx = this.fx;
    this.atmosphere.update(ft, this.tiers.tier, this.meter.intensity, sim, camera, fx);
    this.finale.write(ft, fx);
    fx.wallHits.set(this.wallHits);
    camera.update(ft.worldDt);

    // パドルの squash & stretch と光
    const pt = ft.real - this.paddleHitAt;
    const pe = Math.exp(-pt * 14) * this.paddleHitStrength;
    fx.paddleSquashX = 1 + 0.22 * pe * Math.cos(pt * 34);
    fx.paddleSquashY = 1 - 0.35 * pe * Math.cos(pt * 34);
    fx.paddleFlash = Math.exp(-pt * 16) * this.paddleHitStrength;
  }

  /** 勝敗が決まった。大量に起きる音を止め、ステージクリアならフィナーレを、そうでなければゲームオーバーを始める */
  private beginEnding(ft: FrameTime, budget: number, signals: number): void {
    this.state = 'ending';
    this.sounds.quiesce();
    if (this.sim.phase === 'cleared') {
      const s = this.summary;
      const at = (signals & Signal.StageClear) !== 0;
      this.finale.start(ft, at ? s.clearX : FIELD_W / 2, at ? s.clearY : FIELD_H / 2);
    } else {
      this.gameOver.start(ft, budget);
    }
    this.onEnding();
  }

  private finish(cleared: boolean): void {
    if (this.state !== 'ending') return;
    this.state = 'afterglow';
    const score = this.sim.score;
    this.onFinished({ cleared, score, newBest: this.newBest.isNewBest(score) });
  }

  private wallHit(now: number, y: number, side: number, total: number): void {
    const o = this.wallSlot * 4;
    const w = this.wallHits;
    w[o] = y;
    w[o + 1] = now;
    w[o + 2] = side;
    w[o + 3] = Math.min(1.4, 0.7 + total * 0.02);
    this.wallSlot = (this.wallSlot + 1) % WALL_HIT_SLOTS;
  }
}
