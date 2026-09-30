import { DebugHookSlot } from '../../engine/debug-hooks.ts';
import type { LoopFrame } from '../../engine/frame-loop.ts';
import { RelativeDrag } from '../../engine/input.ts';
import type { ReleaseInfo } from '../../engine/input.ts';
import { createPostGraphics } from '../../engine/post-graphics.ts';
import type { QualityLevel } from '../../engine/quality.ts';
import { RenderDriver } from '../../engine/render-driver.ts';
import type { DriverGraphics, GraphicsEvents } from '../../engine/render-driver.ts';
import type { RenderHost } from '../../engine/render-host.ts';
import { elementSurface } from '../../engine/surface.ts';
import type { Surface } from '../../engine/surface.ts';
import type { LayeredBgm } from '../../juice/audio/bgm.ts';
import { audio } from '../../juice/audio/engine.ts';
import type { AudioEngine } from '../../juice/audio/engine.ts';
import type { CameraOffset } from '../../juice/camera.ts';
import { FlashLimiter } from '../../juice/flash.ts';
import type { FrameTime } from '../../juice/frame-time.ts';
import { vibrate } from '../../juice/haptics.ts';
import { bindAudioSwitches } from '../../juice/settings.ts';
import type { SessionSettings } from '../../juice/settings.ts';
import { errorMessage } from '../../shared/errors.ts';
import type { FatalCause } from '../../shared/fatal.ts';
import { FIELD_W, snapshotTuning } from './config.ts';
import type { SimConfig } from './config.ts';
import { createFxState } from './fx/fx-state.ts';
import type { FxState } from './fx/fx-state.ts';
import { Run } from './run.ts';
import type { RunServices } from './run.ts';
import { inputActive, IDLE, reduceSession, releaseLaunches, releaseSkips, worldAdvances } from './session-state.ts';
import type { SessionAction, SessionState } from './session-state.ts';
import { breakoutSettings } from './settings.ts';
import { Sim } from './sim/sim.ts';
import type { StageDef } from './sim/stage-parse.ts';
import { createBreakoutBgm } from './sounds/bgm.ts';
import { STAGES } from './stages/stages.ts';
import type { HudLayout, RunMode, SessionCallbacks, SessionHandle } from './types.ts';
import { computeLayout } from './view/layout.ts';
import type { Layout } from './view/layout.ts';
import { LOOK } from './view/look.ts';
import { BreakoutView } from './view/scene.ts';
import type { BloomTarget, SceneSource } from './view/scene.ts';

/** キー入力でのパドルの速さ（u / 秒） */
const KEY_SPEED = 13;
/** 描画前に塗りつぶす色（背景のいちばん暗い色） */
const CLEAR_COLOR = 0x020108;

/** 描画一式（本番では RenderHost と PostChain）。GPU を失ったら、RenderDriver が捨てて作り直す */
export type SessionGraphics = DriverGraphics & BloomTarget;

/** 入力から呼ばれる相手。onMove は横方向の移動量（CSS ピクセル）、onRelease は指や発射キーを離したとき */
export type InputHandlers = {
  onMove: (dxPx: number) => void;
  onRelease: (info: ReleaseInfo) => void;
};

/** 指とキーの入力（本番では RelativeDrag） */
export type SessionInput = {
  setActive(active: boolean): void;
  /** キー入力による移動の向き（-1, 0, 1） */
  readonly keyDirection: number;
  dispose(): void;
};

/** セッションが外から受け取るもの。本番ではブラウザのもの（browserEnv）、テストでは代役を渡す */
export type SessionEnv = {
  /** 描画一式を作る。view のシーンを描く */
  createGraphics(view: BreakoutView, events: GraphicsEvents): Promise<SessionGraphics>;
  /** 入力を受け始める。now は押した時刻を測る時計（ms） */
  createInput(handlers: InputHandlers, now: () => number): SessionInput;
  surface: Surface;
  audio: AudioEngine;
  settings: SessionSettings;
  vibrate(pattern: number | readonly number[]): void;
  /** sim の乱数の種（32 ビット） */
  randomSeed(): number;
  /** 今の時刻（ms、performance.now() の時間軸）。入力の押した時刻と勝敗が決まった時刻は、この時計で測る */
  now(): number;
  stages: readonly StageDef[];
  /** プレイの開始時に取る調整値の写し */
  config(): SimConfig;
  /** 開発用の操作口（debugHooksOf と window.__breakout）を用意する */
  debug: boolean;
};

/** 何もないフィールド。タイトルやステージ選択の背景に使う。世界は進めず、読むだけなので作り直さない */
type IdleScene = SceneSource & { readonly fx: FxState };

function createIdleScene(): IdleScene {
  return { sim: Sim.idle(), presentOffset: 0, fx: createFxState(false) };
}

/** 開発ビルドで window.__breakout に置く操作口。調整パネルと、ブラウザの開発者ツールから使う */
export type BreakoutDebugHooks = {
  readonly debugInfo: {
    backend: string;
    quality: number;
    balls: number;
    /** 残っている壊せるブロックの数 */
    breakable: number;
    phase: Sim['phase'];
    audio: AudioContextState | 'none';
    voices: number;
    score: number;
    /** ステージクリアのボールボーナスのうち、まだ得点にしていない数 */
    bonusLeft: number;
  };
  readonly debugAutoplay: boolean;
  /** パドルを自動で動かし、発射させる（入力の代わりをするだけで、sim には直接触らない） */
  setDebugAutoplay(on: boolean): void;
  /** ボールをまとめて足す（性能の計測に使う） */
  debugAddBalls(n: number): void;
  /** プレイ中で、一時停止していない */
  readonly running: boolean;
  readonly host: RenderHost | null;
};

declare global {
  interface Window {
    __breakout?: BreakoutDebugHooks;
  }
}

/** 開発ビルドで window.__breakout に置く操作口 */
const debugSlot = new DebugHookSlot<BreakoutDebugHooks>('__breakout');

/**
 * ブロック崩しの画面が表示されている間だけ生きている、ゲーム本体。
 *
 * 描画一式とフレームのループ（RenderDriver）・入力・BGM・フラッシュの制限・present の時計を持ち、
 * prepare のたびに新しいプレイ（Run）を作る。入力を受け付けるか、世界を進めるかは、状態（SessionState）だけから決める。
 *
 * 描画は必要なフレームだけ行う。世界が進んだフレームと、見た目が変わる操作（大きさ・HUD の配置・品質・
 * プレイの切り替え・一時停止・設定・GPU の作り直し）のあとのフレーム（RenderDriver.invalidate）を描き、同じ絵になるフレームは描かない。
 *
 * フレームの処理で例外が投げられたら、プレイを捨てて、致命的な失敗（internal）を 1 回だけ知らせる。
 * GPU を失って作り直せなかったときは lost を知らせる。どちらの後も、命令は何もしない。
 */
class GameSession implements SessionHandle {
  private readonly env: SessionEnv;
  private readonly cb: SessionCallbacks;
  private readonly view = new BreakoutView();
  private readonly driver: RenderDriver<SessionGraphics>;
  private readonly bgm: LayeredBgm;
  private readonly flashes = new FlashLimiter(3, 1);
  private readonly drag: SessionInput;
  private readonly unobserveSurface: () => void;
  private readonly unsubscribeSettings: () => void;
  private readonly services: RunServices;
  private readonly camOut: CameraOffset = { x: 0, y: 0, rotation: 0, zoom: 1 };
  private readonly idleCam: CameraOffset = { x: 0, y: 0, rotation: 0, zoom: 1 };
  private readonly idleTime: FrameTime = { realDt: 0, worldDt: 0, real: 0, world: 0, present: 0 };
  private state: SessionState = IDLE;
  private run: Run | null = null;
  private readonly idle: IdleScene = createIdleScene();
  private layout: Layout = computeLayout(1, 1, 0, 0);
  private hudLayout: HudLayout = { top: 0, bottom: 0, scoreAnchor: null };
  private budget = 1;
  /** セッションの実時間（秒）。一時停止中と、世界を進めない間は進まない */
  private real = 0;
  /** present の時計。プレイの間は run の present に合わせ、プレイをまたいで戻らない */
  private present = 0;
  private nextRunId = 1;
  private autoplay = false;
  /** 致命的な失敗を知らせた。以後は何もしない */
  private failed = false;
  private disposed = false;

  constructor(env: SessionEnv, cb: SessionCallbacks) {
    this.env = env;
    this.cb = cb;
    this.bgm = createBreakoutBgm(env.audio);
    const view = this.view;
    this.services = {
      audio: env.audio,
      bgm: this.bgm,
      flashes: this.flashes,
      particles: view.particles,
      debris: view.debris,
      fallenBalls: view.fallenBalls,
      vibrate: (pattern) => env.vibrate(pattern),
      inputNow: () => env.now() / 1000,
    };
    this.driver = new RenderDriver<SessionGraphics>({
      createGraphics: (events) => env.createGraphics(this.view, events),
      client: {
        attach: (g) => {
          this.view.setPost(g);
          this.relayout();
          this.draw(false);
        },
        detach: () => {
          this.view.setPost(null);
          this.view.invalidateGpu();
        },
        quality: (q) => this.applyQuality(q),
        update: (frame) => this.update(frame),
        fail: (cause, error) => this.fail(cause, error),
      },
      now: () => env.now(),
    });
    this.drag = env.createInput({ onMove: this.onMove, onRelease: this.onRelease }, () => env.now());
    this.unobserveSurface = env.surface.observe(() => this.relayout());
    this.unsubscribeSettings = bindAudioSwitches(env.settings, env.audio, this.invalidate);
  }

  /** 描画の準備（パイプラインのコンパイルと最初の描画）が済んだら解決する。AudioContext もその間に作っておく */
  static async create(env: SessionEnv, cb: SessionCallbacks): Promise<GameSession> {
    const s = new GameSession(env, cb);
    try {
      const attached = s.driver.start();
      // AudioContext を作る重い処理を、GPU の初期化を待つ間に済ませる。最初のタップで固まらないように
      env.audio.preload();
      await attached;
    } catch (e) {
      s.dispose();
      throw e;
    }
    if (s.disposed) throw new Error('GameSession was disposed while starting');
    if (env.debug) s.installDebugHooks();
    return s;
  }

  // ---- GamePort ----

  prepare(mode: RunMode, previousBest: number): void {
    if (!this.alive) return;
    this.discardRun();
    const run = new Run({
      id: this.nextRunId++,
      mode,
      stages: this.env.stages,
      previousBest,
      seed: this.env.randomSeed(),
      config: this.env.config(),
      presentOffset: this.present,
      services: this.services,
    });
    this.run = run;
    this.applyScoreAnchor();
    this.env.audio.setPaused(false);
    this.bgm.restart();
    this.dispatch({ t: 'prepare', id: run.id });
    this.cb.onHud(run.hud);
  }

  begin(): void {
    if (!this.alive || !this.dispatch({ t: 'begin' })) return;
    this.env.audio.unlock();
    this.bgm.start();
  }

  setPaused(paused: boolean): void {
    if (!this.alive || !this.dispatch({ t: 'setPaused', paused })) return;
    this.env.audio.setPaused(paused);
    if (paused) this.bgm.pause();
    else this.bgm.resume();
  }

  endRun(): void {
    if (!this.alive) return;
    this.discardRun();
    this.env.audio.setPaused(false);
    this.bgm.pause();
  }

  setHudLayout(layout: HudLayout): void {
    if (!this.alive) return;
    this.hudLayout = layout;
    this.relayout();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.run?.dispose();
    this.run = null;
    this.state = IDLE;
    this.drag.dispose();
    this.unobserveSurface();
    this.unsubscribeSettings();
    this.bgm.dispose();
    this.env.audio.setPaused(false);
    this.view.setPost(null);
    this.driver.dispose();
    this.view.dispose();
    debugSlot.unpublish(this);
  }

  // ---- 状態 ----

  private get alive(): boolean {
    return !this.disposed && !this.failed;
  }

  /** 状態を進める。変わったら入力の受け付けを合わせ、次のフレームを描く。変わったかを返す */
  private dispatch(a: SessionAction): boolean {
    const next = reduceSession(this.state, a);
    if (next === this.state) return false;
    this.state = next;
    this.drag.setActive(inputActive(next));
    this.invalidate();
    return true;
  }

  /** 今のプレイを捨て、何もないフィールドへ戻す */
  private discardRun(): void {
    const run = this.run;
    if (run) {
      run.dispose();
      this.run = null;
    }
    this.view.clearTransient();
    this.dispatch({ t: 'endRun' });
    this.invalidate();
  }

  private readonly invalidate = (): void => {
    this.driver.invalidate();
  };

  /**
   * 続けられなくなった（フレームのループはもう止まっている）。プレイを捨てて、画面へ 1 回だけ知らせる。
   * 知らせた後は、命令もフレームも何もしない
   */
  private fail(cause: FatalCause, error: unknown): void {
    if (!this.alive) return;
    this.failed = true;
    this.discardRun();
    this.env.audio.setPaused(false);
    this.bgm.pause();
    this.cb.onEvent({ t: 'fatal', cause, message: errorMessage(error) });
  }

  // ---- 入力 ----

  private readonly onMove = (dxPx: number): void => {
    const run = this.run;
    if (!run || !inputActive(this.state)) return;
    run.input.moveBy((dxPx / this.layout.pxPerUnit) * run.sim.config.paddle.dragGain);
  };

  private readonly onRelease = (info: ReleaseInfo): void => {
    const run = this.run;
    if (!run) return;
    if (releaseLaunches(this.state)) run.input.latchLaunch();
    else if (releaseSkips(this.state, info.pressedAt)) run.skip();
  };

  /** キー入力と自動操作を、パドルの目標位置と発射の合図へ反映する。dt は実時間の秒 */
  private driveInput(run: Run, dt: number): void {
    if (!inputActive(this.state)) return;
    const dir = this.drag.keyDirection;
    if (dir !== 0) run.input.moveBy(dir * KEY_SPEED * dt);
    if (this.autoplay) this.autoplayInput(run);
  }

  /** 開発用: 落ちてくるボールのうち一番低いものの下へパドルを動かし、乗っているボールは発射する */
  private autoplayInput(run: Run): void {
    const b = run.sim.balls;
    let best = -1;
    let bestY = Infinity;
    for (let i = 0; i < b.count; i++) {
      if (b.dy[i] < 0 && b.y[i] > 1.2 && b.y[i] < bestY) {
        bestY = b.y[i];
        best = i;
      }
    }
    if (best >= 0) run.input.moveTo(b.x[best] + (Math.random() - 0.5) * 0.8);
    if (run.sim.attached && releaseLaunches(this.state)) run.input.latchLaunch();
  }

  // ---- フレーム ----

  /** 1 フレーム進めて描画用のデータを書き出す。世界が進んだら true */
  private update(frame: Readonly<LoopFrame>): boolean {
    this.env.audio.tick();
    const run = this.run;
    let advanced = false;
    if (run && worldAdvances(this.state)) {
      this.real += frame.dt;
      this.driveInput(run, frame.dt);
      this.present = run.advance(frame.dt, this.real, this.budget).present;
      advanced = true;
      this.emitSignals(run);
    }
    if (!this.alive) return false;
    this.draw(advanced);
    const current = this.run;
    if (current) this.cb.onHud(current.hud);
    return advanced;
  }

  /**
   * プレイの節目（Run.signals）を、状態へ反映して画面へ知らせる。
   * 知らせた先でプレイが切り替わったら、古いプレイの節目はもう知らせない。
   */
  private emitSignals(run: Run): void {
    const sig = run.signals;
    if (!Number.isNaN(sig.endingAt) && this.dispatch({ t: 'ending', at: sig.endingAt })) this.cb.onEvent({ t: 'runEnding' });
    if (!this.alive || this.run !== run) return;
    if (sig.finished && this.dispatch({ t: 'finished' })) this.cb.onEvent({ t: 'finished', result: sig.finished });
  }

  /** 今の状態を描画用のデータへ書き出す。描くかどうかに関係なく毎フレーム呼ぶので、描いた絵は必ず今の状態になる */
  private draw(worldAdvanced: boolean): void {
    const view = this.view;
    const run = this.run;
    const motion = this.env.settings.cameraMotion;
    if (run) {
      run.camera.sample(motion, this.camOut);
      view.apply(run.fx, run.frameTime, motion.jolt);
      view.sync(run, run.alpha, run.input.target, this.camOut, worldAdvanced);
      return;
    }
    const t = this.idleTime;
    t.real = this.real;
    t.present = this.present;
    view.apply(this.idle.fx, t, motion.jolt);
    view.sync(this.idle, 0, FIELD_W / 2, this.idleCam, false);
  }

  // ---- 描画先 ----

  /** 描画領域と HUD の配置から、フィールドの配置を決め直す */
  private relayout(): void {
    if (!this.alive) return;
    const { width, height } = this.env.surface;
    const hud = this.hudLayout;
    this.layout = computeLayout(width, height, hud.top, hud.bottom);
    this.view.setLayout(this.layout);
    this.driver.setSize(width, height);
    this.applyScoreAnchor();
    this.invalidate();
  }

  /** HUD のスコアの位置（描画領域の左上からの CSS ピクセル）を、ワールド座標にしてプレイへ渡す */
  private applyScoreAnchor(): void {
    const run = this.run;
    const a = this.hudLayout.scoreAnchor;
    if (!run || !a) return;
    const l = this.layout;
    run.setScoreAnchor(l.left + a.x / l.pxPerUnit, l.top - a.y / l.pxPerUnit);
  }

  /** 品質の段階のうち、パーティクルと破片の予算を反映する（描画一式への反映は RenderDriver が行う） */
  private applyQuality(q: QualityLevel): void {
    this.view.setParticleBudget(q.particles);
    this.budget = q.particles;
  }

  // ---- 開発用 ----

  private installDebugHooks(): void {
    const hooks = new DebugHooks({
      info: () => {
        const sim = this.run?.sim ?? this.idle.sim;
        const a = this.env.audio;
        return {
          backend: this.driver.graphics?.backend ?? 'none',
          quality: this.driver.qualityLevel,
          balls: sim.ballCount,
          breakable: sim.blocks.breakableCount,
          phase: sim.phase,
          audio: a.ctx?.state ?? 'none',
          voices: a.activeVoices('sfx') + a.activeVoices('bgm'),
          score: sim.score,
          bonusLeft: sim.clearBonusRemaining,
        };
      },
      autoplay: () => this.autoplay,
      setAutoplay: (on) => {
        this.autoplay = on;
      },
      addBalls: (n) => {
        if (!this.alive || !this.run) return;
        this.run.sim.debugSpawnBalls(n);
        this.invalidate();
      },
      running: () => this.state.k === 'run' && this.state.stage === 'playing' && !this.state.paused,
      host: () => this.driver.graphics?.host ?? null,
    });
    debugSlot.publish(this, hooks);
  }
}

type DebugSource = {
  info(): BreakoutDebugHooks['debugInfo'];
  autoplay(): boolean;
  setAutoplay(on: boolean): void;
  addBalls(n: number): void;
  running(): boolean;
  host(): RenderHost | null;
};

class DebugHooks implements BreakoutDebugHooks {
  private readonly src: DebugSource;

  constructor(src: DebugSource) {
    this.src = src;
  }

  get debugInfo(): BreakoutDebugHooks['debugInfo'] {
    return this.src.info();
  }

  get debugAutoplay(): boolean {
    return this.src.autoplay();
  }

  setDebugAutoplay(on: boolean): void {
    this.src.setAutoplay(on);
  }

  debugAddBalls(n: number): void {
    this.src.addBalls(n);
  }

  get running(): boolean {
    return this.src.running();
  }

  get host(): RenderHost | null {
    return this.src.host();
  }
}

/** 開発用の操作口を用意したセッションなら、その操作口。本番ビルドでは null */
export function debugHooksOf(session: SessionHandle): BreakoutDebugHooks | null {
  return debugSlot.of(session);
}

/** sim の乱数の種。暗号用の乱数から 32 ビットを取る */
function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/** ブラウザで動かすときの SessionEnv。描画領域は container */
function browserEnv(container: HTMLElement): SessionEnv {
  return {
    createGraphics: (view, events) =>
      createPostGraphics({ container, scene: view.scene, camera: view.camera, exposure: LOOK.exposure, clearColor: CLEAR_COLOR, events }),
    createInput: (handlers, now) => new RelativeDrag(container, handlers, { now }),
    surface: elementSurface(container),
    audio,
    settings: breakoutSettings(),
    vibrate,
    randomSeed,
    now: () => performance.now(),
    stages: STAGES,
    config: snapshotTuning,
    debug: Boolean(import.meta.env.DEV),
  };
}

/** SessionEnv を差し替えてゲーム本体を作る。描画の準備が済んだら解決する */
export function startGameSession(env: SessionEnv, cb: SessionCallbacks): Promise<SessionHandle> {
  return GameSession.create(env, cb);
}

/** ゲーム本体を作る。描画の準備（パイプラインのコンパイルと最初の描画）が済んだら解決する */
export function createGameSession(container: HTMLElement, cb: SessionCallbacks): Promise<SessionHandle> {
  return startGameSession(browserEnv(container), cb);
}
