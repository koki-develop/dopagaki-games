import { FrameLoop } from '../../engine/frame-loop.ts';
import type { FrameClient, FrameTarget, LoopFrame } from '../../engine/frame-loop.ts';
import { RelativeDrag } from '../../engine/input.ts';
import type { ReleaseInfo } from '../../engine/input.ts';
import { PostChain } from '../../engine/post.ts';
import { QUALITY_LEVELS, QualityGovernor } from '../../engine/quality.ts';
import type { QualityLevel } from '../../engine/quality.ts';
import { RenderHost } from '../../engine/render-host.ts';
import { audio } from '../../juice/audio/engine.ts';
import type { AudioEngine } from '../../juice/audio/engine.ts';
import type { CameraOffset } from '../../juice/camera.ts';
import { FlashLimiter } from '../../juice/flash.ts';
import { vibrate } from '../../juice/haptics.ts';
import { settings } from '../../juice/settings.ts';
import { errorMessage } from '../../shared/errors.ts';
import { FIELD_W, snapshotTuning } from './config.ts';
import type { SimConfig } from './config.ts';
import type { FrameTime } from './frame-time.ts';
import { createFxState } from './fx/fx-state.ts';
import type { FxState } from './fx/fx-state.ts';
import { Run } from './run.ts';
import type { RunServices } from './run.ts';
import { inputActive, IDLE, reduceSession, releaseLaunches, releaseSkips, worldAdvances } from './session-state.ts';
import type { SessionAction, SessionState } from './session-state.ts';
import { Sim } from './sim/sim.ts';
import type { StageDef } from './sim/stage-parse.ts';
import { Bgm } from './sounds/bgm.ts';
import { STAGES } from './stages/stages.ts';
import type { FatalCause, HudLayout, RunMode, SessionCallbacks, SessionHandle } from './types.ts';
import { computeLayout } from './view/layout.ts';
import type { Layout } from './view/layout.ts';
import { LOOK } from './view/look.ts';
import { BreakoutView } from './view/scene.ts';
import type { BloomTarget, SceneSource } from './view/scene.ts';

/** キー入力でのパドルの速さ（u / 秒） */
const KEY_SPEED = 13;
/** 描画前に塗りつぶす色（背景のいちばん暗い色） */
const CLEAR_COLOR = 0x020108;

/** 描画一式（本番では RenderHost と PostChain）。GPU を失ったら、セッションが捨てて作り直す */
export type SessionGraphics = FrameTarget &
  BloomTarget & {
    readonly backend: string;
    /** 開発用の操作口に出す RenderHost。代役では null */
    readonly host: RenderHost | null;
    /** 描画領域の CSS ピクセルの大きさ */
    setSize(cssWidth: number, cssHeight: number): void;
    setQuality(q: QualityLevel): void;
    /** パイプラインを前もってコンパイルし、1 フレーム描画する。最初の描画でコンパイル待ちが起きないように */
    warmUp(): Promise<void>;
    dispose(): void;
  };

export type GraphicsEvents = {
  /** GPU を失った。一度だけ呼ぶ */
  onLost(): void;
  /** 描画バッファの大きさが変わった */
  onResize(): void;
};

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

/** 描画領域。大きさの変化を observe で知らせる */
type SessionSurface = {
  readonly width: number;
  readonly height: number;
  /** 大きさが変わるたびに cb を呼ぶ。返した関数で監視をやめる */
  observe(cb: () => void): () => void;
};

/** セッションが読む設定 */
type SessionSettings = {
  get(): { readonly shake: boolean };
  /** カメラの引きとビートの拍動に掛ける倍率 */
  readonly cameraMotionScale: number;
  subscribe(listener: () => void): () => void;
};

/** セッションが外から受け取るもの。本番ではブラウザのもの（browserEnv）、テストでは代役を渡す */
export type SessionEnv = {
  /** 描画一式を作る。view のシーンを描く */
  createGraphics(view: BreakoutView, events: GraphicsEvents): Promise<SessionGraphics>;
  /** 入力を受け始める。now は押した時刻を測る時計（ms） */
  createInput(handlers: InputHandlers, now: () => number): SessionInput;
  surface: SessionSurface;
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

/** 何もないフィールド。タイトルやステージ選択の背景に使う。世界は進めない */
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
    live: number;
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

/**
 * ブロック崩しの画面が表示されている間だけ生きている、ゲーム本体。
 *
 * 描画一式・入力・フレームのループ・品質の判定・BGM・フラッシュの制限・present の時計を持ち、
 * prepare のたびに新しいプレイ（Run）を作る。入力を受け付けるか、世界を進めるかは、状態（SessionState）だけから決める。
 *
 * 描画は必要なフレームだけ行う。世界が進んだフレームと、見た目が変わる操作（大きさ・HUD の配置・品質・
 * プレイの切り替え・一時停止・設定・GPU の作り直し）のあとのフレーム（FrameLoop.invalidate）を描き、同じ絵になるフレームは描かない。
 *
 * フレームの処理で例外が投げられたら、ループを止め、プレイを捨てて、致命的な失敗（internal）を 1 回だけ知らせる。
 * GPU を失って作り直せなかったときは lost を知らせる。どちらの後も、命令は何もしない。
 */
class GameSession implements SessionHandle {
  private readonly env: SessionEnv;
  private readonly cb: SessionCallbacks;
  private readonly view = new BreakoutView();
  private readonly governor = new QualityGovernor(QUALITY_LEVELS.length - 1);
  private readonly bgm: Bgm;
  private readonly flashes = new FlashLimiter(3, 1);
  private readonly drag: SessionInput;
  private readonly unobserveSurface: () => void;
  private readonly unsubscribeSettings: () => void;
  private readonly services: RunServices;
  private readonly camOut: CameraOffset = { x: 0, y: 0, rotation: 0, zoom: 1 };
  private readonly idleCam: CameraOffset = { x: 0, y: 0, rotation: 0, zoom: 1 };
  private readonly idleTime: FrameTime = { realDt: 0, worldDt: 0, real: 0, world: 0, present: 0 };
  private graphics: SessionGraphics | null = null;
  private loop: FrameLoop | null = null;
  /** 描画一式を作るたびに増やす。古い描画一式からの知らせと、途中で追い越された作り直しを捨てる */
  private graphicsGeneration = 0;
  private state: SessionState = IDLE;
  private run: Run | null = null;
  private idle: IdleScene = createIdleScene();
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
  private debugHooks: BreakoutDebugHooks | null = null;

  constructor(env: SessionEnv, cb: SessionCallbacks) {
    this.env = env;
    this.cb = cb;
    this.bgm = new Bgm(env.audio);
    const view = this.view;
    this.services = {
      audio: env.audio,
      bgm: this.bgm,
      flashes: this.flashes,
      particles: view.particles,
      debris: view.debris,
      vibrate: (pattern) => env.vibrate(pattern),
      inputNow: () => env.now() / 1000,
    };
    this.drag = env.createInput({ onMove: this.onMove, onRelease: this.onRelease }, () => env.now());
    this.unobserveSurface = env.surface.observe(() => this.relayout());
    this.unsubscribeSettings = env.settings.subscribe(this.invalidate);
  }

  /** 描画の準備（パイプラインのコンパイルと最初の描画）が済んだら解決する。AudioContext もその間に作っておく */
  static async create(env: SessionEnv, cb: SessionCallbacks): Promise<GameSession> {
    const s = new GameSession(env, cb);
    try {
      const attached = s.attachGraphics();
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
    if (paused) this.bgm.pause();
    else this.bgm.resume();
  }

  endRun(): void {
    if (!this.alive) return;
    this.discardRun();
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
    this.graphicsGeneration++;
    this.run?.dispose();
    this.run = null;
    this.state = IDLE;
    this.loop?.stop();
    this.loop = null;
    this.drag.dispose();
    this.unobserveSurface();
    this.unsubscribeSettings();
    this.bgm.dispose();
    this.view.setPost(null);
    this.graphics?.dispose();
    this.graphics = null;
    this.view.dispose();
    if (this.debugHooks) unpublishDebugHooks(this.debugHooks);
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
    this.idle = createIdleScene();
    this.view.clearTransient();
    this.dispatch({ t: 'endRun' });
    this.invalidate();
  }

  /** 次のフレームを必ず描く */
  private readonly invalidate = (): void => {
    this.loop?.invalidate();
  };

  /**
   * 続けられなくなった。ループを止め、プレイを捨てて、画面へ 1 回だけ知らせる。
   * 知らせた後は、命令もフレームも何もしない
   */
  private fail(cause: FatalCause, error: unknown): void {
    if (!this.alive) return;
    this.failed = true;
    this.loop?.stop();
    this.loop = null;
    this.discardRun();
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

  private readonly client: FrameClient = {
    onQualityChange: (level) => this.applyQuality(level),
    update: (frame) => this.update(frame),
    onError: (error) => this.fail('internal', error),
  };

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
    if (run) {
      const s = this.env.settings;
      run.camera.sample(s.get().shake ? 1 : 0, s.cameraMotionScale, this.camOut);
      view.apply(run.fx, run.frameTime);
      view.sync(run, run.alpha, run.input.target, this.camOut, worldAdvanced);
      return;
    }
    const t = this.idleTime;
    t.real = this.real;
    t.present = this.present;
    view.apply(this.idle.fx, t);
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
    this.graphics?.setSize(width, height);
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

  private applyQuality(level: number): void {
    const q = QUALITY_LEVELS[Math.min(QUALITY_LEVELS.length - 1, Math.max(0, level))];
    this.graphics?.setQuality(q);
    this.view.setParticleBudget(q.particles);
    this.budget = q.particles;
    this.invalidate();
  }

  /**
   * 描画一式を作り、パイプラインを前もってコンパイルし、フレームのループを回し始める。
   * 初回と、GPU を失ったときに呼ぶ。シーンと状態はそのまま使う。途中で別の作り直しに追い越されたら、作ったものを捨てる。
   */
  private async attachGraphics(): Promise<void> {
    const gen = ++this.graphicsGeneration;
    const stale = () => !this.alive || gen !== this.graphicsGeneration;
    try {
      const g = await this.env.createGraphics(this.view, {
        onLost: () => {
          if (!stale()) void this.recover();
        },
        onResize: this.invalidate,
      });
      if (stale()) {
        g.dispose();
        return;
      }
      this.graphics = g;
      this.view.setPost(g);
      this.applyQuality(this.governor.level);
      this.relayout();
      this.draw(false);
      await g.warmUp();
      if (stale()) return;
      const loop = new FrameLoop({ target: g, governor: this.governor, client: this.client, now: () => this.env.now() });
      this.loop = loop;
      loop.start();
    } catch (e) {
      // 追い越された作り直しの失敗は、今の描画に関係ないので知らせない
      if (!stale()) throw e;
    }
  }

  /**
   * GPU を失った。描画一式とループを作り直す（品質の判定は同じものを使い続ける）。
   * インスタンスのバッファは新しいレンダラーが最初に使うときに全体を送り、ブロックは次のフレームで書き出し直す。
   * 作り直せなければ、プレイを捨てて致命的な失敗（lost）として知らせる。
   */
  private async recover(): Promise<void> {
    if (!this.alive) return;
    this.loop?.stop();
    this.loop = null;
    this.view.setPost(null);
    this.graphics?.dispose();
    this.graphics = null;
    this.view.invalidateGpu();
    try {
      await this.attachGraphics();
    } catch (e) {
      this.fail('lost', e);
    }
  }

  // ---- 開発用 ----

  private installDebugHooks(): void {
    const hooks = new DebugHooks({
      info: () => {
        const sim = this.run?.sim ?? this.idle.sim;
        const a = this.env.audio;
        return {
          backend: this.graphics?.backend ?? 'none',
          quality: this.governor.level,
          balls: sim.ballCount,
          live: sim.blocks.liveCount,
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
      host: () => this.graphics?.host ?? null,
    });
    this.debugHooks = hooks;
    debugHooksBySession.set(this, hooks);
    publishDebugHooks(hooks);
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

const debugHooksBySession = new WeakMap<SessionHandle, BreakoutDebugHooks>();

/**
 * 生きているセッションの操作口。window.__breakout には最後に作ったものを置く。
 * 開発ビルドの StrictMode では 2 つのセッションが同時に作られ、先に作った方が後から捨てられることがあるので、
 * 捨てたときは残っているものへ戻す。
 */
const liveHooks: BreakoutDebugHooks[] = [];

function publishDebugHooks(hooks: BreakoutDebugHooks): void {
  liveHooks.push(hooks);
  if (typeof window !== 'undefined') window.__breakout = hooks;
}

function unpublishDebugHooks(hooks: BreakoutDebugHooks): void {
  const i = liveHooks.indexOf(hooks);
  if (i >= 0) liveHooks.splice(i, 1);
  if (typeof window === 'undefined') return;
  const last = liveHooks[liveHooks.length - 1];
  if (last) window.__breakout = last;
  else delete window.__breakout;
}

/** 開発用の操作口を用意したセッションなら、その操作口。本番ビルドでは null */
export function debugHooksOf(session: SessionHandle): BreakoutDebugHooks | null {
  return debugHooksBySession.get(session) ?? null;
}

/** sim の乱数の種。暗号用の乱数から 32 ビットを取る */
function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/** RenderHost と PostChain を作り、container の先頭に canvas を置く */
async function createBrowserGraphics(container: HTMLElement, view: BreakoutView, events: GraphicsEvents): Promise<SessionGraphics> {
  // 開発ビルドでは ?backend=webgl で WebGL2 バックエンドを強制できる（フォールバック経路の確認用）
  const forceWebGL = Boolean(import.meta.env.DEV) && new URLSearchParams(window.location.search).get('backend') === 'webgl';
  const host = await RenderHost.create({
    exposure: LOOK.exposure,
    clearColor: CLEAR_COLOR,
    forceWebGL,
    onLost: events.onLost,
    onResize: events.onResize,
  });
  container.prepend(host.canvas);
  const post = new PostChain(host, view.scene, view.camera);
  return {
    backend: host.backend,
    host,
    setSize: (w, h) => host.setSize(w, h),
    setQuality: (q) => {
      host.setPixelRatioCap(q.pixelRatio);
      post.setQuality(q);
    },
    setBloom: (strength, radius, threshold) => post.setBloom(strength, radius, threshold),
    warmUp: () => post.warmUp(),
    setAnimationLoop: (cb) => host.setAnimationLoop(cb),
    render: () => post.render(),
    dispose: () => {
      post.dispose();
      host.dispose();
    },
  };
}

/** ブラウザで動かすときの SessionEnv。描画領域は container */
function browserEnv(container: HTMLElement): SessionEnv {
  return {
    createGraphics: (view, events) => createBrowserGraphics(container, view, events),
    createInput: (handlers, now) => new RelativeDrag(container, handlers, { now }),
    surface: {
      get width() {
        return container.clientWidth;
      },
      get height() {
        return container.clientHeight;
      },
      observe(cb) {
        const ro = new ResizeObserver(cb);
        ro.observe(container);
        return () => ro.disconnect();
      },
    },
    audio,
    settings,
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
