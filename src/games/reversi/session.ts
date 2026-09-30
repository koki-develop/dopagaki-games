import { DebugHookSlot } from '../../engine/debug-hooks.ts';
import type { LoopFrame } from '../../engine/frame-loop.ts';
import { PointerInput } from '../../engine/pointer.ts';
import type { PointerHandlers } from '../../engine/pointer.ts';
import { createPostGraphics } from '../../engine/post-graphics.ts';
import type { QualityLevel } from '../../engine/quality.ts';
import { RenderDriver } from '../../engine/render-driver.ts';
import type { DriverGraphics, GraphicsEvents } from '../../engine/render-driver.ts';
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
import { Rng } from '../../shared/rng.ts';
import { chooseMove } from './ai/cpu.ts';
import { DiscField } from './fx/discs.ts';
import { createFxState } from './fx/fx-state.ts';
import type { FxState } from './fx/fx-state.ts';
import { computeLayout, squareAt, toPxX, toPxY } from './geometry.ts';
import type { Layout } from './geometry.ts';
import { BLACK, emptyCount, initialPosition, parseSquare, positionFromRows, WHITE } from './rules/position.ts';
import type { Position } from './rules/position.ts';
import { Run } from './run.ts';
import type { RunServices } from './run.ts';
import { boardInput, IDLE, inputActive, reduceSession, releaseSkips, worldAdvances } from './session-state.ts';
import type { SessionAction, SessionState } from './session-state.ts';
import { reversiSettings } from './settings.ts';
import { createReversiBgm } from './sounds/bgm.ts';
import type { Callout, HudLayout, MatchSetup, SessionCallbacks, SessionHandle } from './types.ts';
import { LOOK } from './view/look.ts';
import { ReversiView } from './view/scene.ts';
import type { PostTarget } from './view/scene.ts';

/** 描画前に塗りつぶす色（背景のいちばん暗い色） */
const CLEAR_COLOR = 0x020108;

/** 描画一式（本番では RenderHost と PostChain）。GPU を失ったら、RenderDriver が捨てて作り直す */
export type SessionGraphics = DriverGraphics & PostTarget;

/** 盤への入力（本番では PointerInput） */
export type SessionInput = {
  setActive(active: boolean): void;
  dispose(): void;
};

/** セッションが外から受け取るもの。本番ではブラウザのもの（browserEnv）、テストでは代役を渡す */
export type SessionEnv = {
  /** 描画一式を作る。view のシーンを描く */
  createGraphics(view: ReversiView, events: GraphicsEvents): Promise<SessionGraphics>;
  /** 入力を受け始める。now は押した時刻を測る時計（ms） */
  createInput(handlers: PointerHandlers, now: () => number): SessionInput;
  surface: Surface;
  audio: AudioEngine;
  settings: SessionSettings;
  vibrate(pattern: number | readonly number[]): void;
  /** 対局の乱数の種（32 ビット）。CPU の揺らぎに使う */
  randomSeed(): number;
  /** 今の時刻（ms、performance.now() の時間軸）。入力の押した時刻と終局した時刻は、この時計で測る */
  now(): number;
  /** 開発用の操作口（debugHooksOf と window.__reversi）を用意する */
  debug: boolean;
};

/** 開発ビルドで window.__reversi に置く操作口。調整パネルと、ブラウザの開発者ツールから使う */
export type ReversiDebugHooks = {
  readonly debugInfo: {
    backend: string;
    quality: number;
    /** 空きマスの数。対局がなければ -1 */
    empties: number;
    turn: 'human' | 'cpu' | null;
    audio: AudioContextState | 'none';
    voices: number;
  };
  readonly debugAutoplay: boolean;
  /** 人の手番が来たら、CPU と同じ選び方ですぐに打つ（入力の代わりをするだけで、対局には直接触らない） */
  setDebugAutoplay(on: boolean): void;
  /**
   * 局面 rows（8 行の各 8 文字。X 黒、O 白、. 空き）から対局を始める。turn は手番、human は人の色。
   * 大きな手の演出を確かめるのに使う。この対局は練習として、記録にも最高スコアの更新にも数えない
   */
  debugStart(rows: readonly string[], turn: 'black' | 'white', human: 'black' | 'white'): void;
  /** 人の手番で、記法のマス（a1〜h8）に打つ（離したのと同じ入力） */
  debugPlay(square: string): void;
};

declare global {
  interface Window {
    __reversi?: ReversiDebugHooks;
  }
}

/** 開発ビルドで window.__reversi に置く操作口 */
const debugSlot = new DebugHookSlot<ReversiDebugHooks>('__reversi');

/** 何もない盤。タイトルの背景に使う。世界は進めない */
type IdleScene = { readonly fx: FxState; readonly discs: DiscField };

function createIdleScene(): IdleScene {
  const discs = new DiscField();
  discs.setPosition(initialPosition());
  return { fx: createFxState(), discs };
}

/**
 * リバーシの画面が表示されている間だけ生きている、ゲーム本体。
 *
 * 描画一式とフレームのループ（RenderDriver）・入力・BGM・フラッシュの制限・present の時計を持ち、
 * start のたびに新しい対局（Run）を作る。入力を受け付けるか、世界を進めるかは、状態（SessionState）だけから決める。
 *
 * フレームの処理で例外が投げられたら、対局を捨てて、致命的な失敗（internal）を 1 回だけ知らせる。
 * GPU を失って作り直せなかったときは lost を知らせる。どちらの後も、命令は何もしない。
 */
class GameSession implements SessionHandle {
  private readonly env: SessionEnv;
  private readonly cb: SessionCallbacks;
  private readonly view = new ReversiView();
  private readonly driver: RenderDriver<SessionGraphics>;
  private readonly bgm: LayeredBgm;
  private readonly flashes = new FlashLimiter(3, 1);
  private readonly input: SessionInput;
  private readonly unobserveSurface: () => void;
  private readonly unsubscribeSettings: () => void;
  private readonly services: RunServices;
  private readonly camOut: CameraOffset = { x: 0, y: 0, rotation: 0, zoom: 1 };
  private readonly idleCam: CameraOffset = { x: 0, y: 0, rotation: 0, zoom: 1 };
  private readonly idleTime: FrameTime = { realDt: 0, worldDt: 0, real: 0, world: 0, present: 0 };
  private state: SessionState = IDLE;
  private run: Run | null = null;
  private idle: IdleScene = createIdleScene();
  private layout: Layout = computeLayout(1, 1, 0, 0);
  private hudLayout: HudLayout = { top: 0, bottom: 0 };
  private budget = 1;
  /** セッションの実時間（秒）。一時停止中と、世界を進めない間は進まない */
  private real = 0;
  /** present の時計。対局の間は run の present に合わせ、対局をまたいで戻らない */
  private present = 0;
  private nextRunId = 1;
  private autoplay = false;
  private autoplayRng = new Rng(1);
  /** 致命的な失敗を知らせた。以後は何もしない */
  private failed = false;
  private disposed = false;

  constructor(env: SessionEnv, cb: SessionCallbacks) {
    this.env = env;
    this.cb = cb;
    this.bgm = createReversiBgm(env.audio);
    const view = this.view;
    this.services = {
      audio: env.audio,
      bgm: this.bgm,
      flashes: this.flashes,
      particles: view.particles,
      vibrate: (pattern) => env.vibrate(pattern),
      callout: (c) => this.emitCallout(c),
      announce: (text) => this.cb.onAnnounce(text),
      inputNow: () => env.now() / 1000,
    };
    this.driver = new RenderDriver<SessionGraphics>({
      createGraphics: (events) => env.createGraphics(this.view, events),
      client: {
        attach: (g) => {
          this.view.setPost(g);
          this.relayout();
          this.draw();
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
    this.input = env.createInput(this.handlers, () => env.now());
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

  start(setup: MatchSetup, bestScore: number): void {
    this.startFrom(setup, bestScore, null);
  }

  /**
   * start と同じ。position を渡すと、その局面から練習の対局を始める（開発用の操作口だけが渡す）。
   * 始まりの演出の最初の音より先に音を解錠する。新しい対局を作れなければ（始められない局面）、今の対局をそのまま続ける
   */
  private startFrom(setup: MatchSetup, bestScore: number, position: Position | null): void {
    if (!this.alive) return;
    this.env.audio.unlock();
    const run = new Run({
      id: this.nextRunId++,
      setup,
      start: position,
      bestScore,
      seed: this.env.randomSeed(),
      real: this.real,
      presentOffset: this.present,
      services: this.services,
    });
    this.discardRun();
    this.run = run;
    this.dispatch({ t: 'start' });
    this.env.audio.setPaused(false);
    this.bgm.restart();
    this.bgm.start();
    this.cb.onHud(run.hud);
    this.cb.onEvent({ t: 'started', setup });
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
    this.input.dispose();
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
    this.input.setActive(inputActive(next));
    if (!boardInput(next)) this.run?.point(-1);
    this.invalidate();
    return true;
  }

  /** 今の対局を捨て、何もない盤へ戻す */
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

  private readonly invalidate = (): void => {
    this.driver.invalidate();
  };

  /**
   * 続けられなくなった（フレームのループはもう止まっている）。対局を捨てて、画面へ 1 回だけ知らせる。
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

  private squareAt(x: number, y: number): number {
    return squareAt(this.layout, x, y);
  }

  private readonly handlers: PointerHandlers = {
    onPress: (x, y) => {
      if (boardInput(this.state)) this.run?.point(this.squareAt(x, y));
    },
    onMove: (x, y) => {
      if (boardInput(this.state)) this.run?.point(this.squareAt(x, y));
    },
    onRelease: (x, y, pressedAt) => {
      const run = this.run;
      if (!run) return;
      if (releaseSkips(this.state, pressedAt)) {
        if (run.skip()) this.emitSignals(run);
        return;
      }
      if (boardInput(this.state)) run.release(this.squareAt(x, y));
    },
    onCancel: () => {
      this.run?.point(-1);
    },
    onKeyMove: (dx, dy) => {
      if (boardInput(this.state)) this.run?.moveCursor(dx, dy);
    },
    onKeyConfirm: (pressedAt) => {
      const run = this.run;
      if (!run) return;
      if (releaseSkips(this.state, pressedAt)) {
        if (run.skip()) this.emitSignals(run);
        return;
      }
      if (boardInput(this.state)) run.confirm();
    },
  };

  /** 開発用: 人の手番が来たら、CPU と同じ選び方ですぐに打つ */
  private driveAutoplay(run: Run): void {
    if (!this.autoplay || !run.humanTurn || !boardInput(this.state)) return;
    run.release(chooseMove(run.match.position, this.autoplayRng));
  }

  // ---- フレーム ----

  /** 1 フレーム進めて描画用のデータを書き出す。世界が進んだら true */
  private update(frame: Readonly<LoopFrame>): boolean {
    this.env.audio.tick();
    const run = this.run;
    let advanced = false;
    if (run && worldAdvances(this.state)) {
      this.real += frame.dt;
      this.present = run.advance(frame.dt, this.real, this.budget).present;
      advanced = true;
      this.emitSignals(run);
      if (this.run === run) this.driveAutoplay(run);
    }
    if (!this.alive) return false;
    this.draw();
    const current = this.run;
    if (current) this.cb.onHud(current.hud);
    return advanced;
  }

  /**
   * 対局の節目（Run.signals）を、状態へ反映して画面へ知らせる。
   * 知らせた先で対局が切り替わったら、古い対局の節目はもう知らせない。
   */
  private emitSignals(run: Run): void {
    const sig = run.signals;
    if (!Number.isNaN(sig.endingAt) && this.dispatch({ t: 'ending', at: sig.endingAt })) this.cb.onEvent({ t: 'runEnding' });
    if (!this.alive || this.run !== run) return;
    if (sig.finished && this.dispatch({ t: 'finished' })) this.cb.onEvent({ t: 'finished', result: sig.finished });
  }

  /** 今の状態を描画用のデータへ書き出す。描くかどうかに関係なく毎フレーム呼ぶので、描いた絵は必ず今の状態になる */
  private draw(): void {
    const view = this.view;
    const run = this.run;
    if (run) {
      const motion = this.env.settings.cameraMotion;
      run.camera.sample(motion, this.camOut);
      view.apply(run.fx, run.frameTime, motion.jolt);
      view.sync(run.discs, this.camOut);
      return;
    }
    const t = this.idleTime;
    t.real = this.real;
    t.present = this.present;
    view.apply(this.idle.fx, t, 0);
    view.sync(this.idle.discs, this.idleCam);
  }

  /** 盤の上の文字を、位置をワールド座標から描画領域の CSS ピクセルへ直して画面へ渡す */
  private emitCallout(c: Callout): void {
    const l = this.layout;
    const out: Callout = 'x' in c ? { ...c, x: toPxX(l, c.x), y: toPxY(l, c.y) } : c;
    this.cb.onCallout(out);
  }

  // ---- 描画先 ----

  /** 描画領域と HUD の配置から、盤の配置を決め直す */
  private relayout(): void {
    if (!this.alive) return;
    const { width, height } = this.env.surface;
    const hud = this.hudLayout;
    this.layout = computeLayout(width, height, hud.top, hud.bottom);
    this.view.setLayout(this.layout);
    this.driver.setSize(width, height);
    this.invalidate();
  }

  /** 品質の段階のうち、粒の予算を反映する（描画一式への反映は RenderDriver が行う） */
  private applyQuality(q: QualityLevel): void {
    this.view.setParticleBudget(q.particles);
    this.budget = q.particles;
  }

  // ---- 開発用 ----

  private installDebugHooks(): void {
    const hooks = new DebugHooks({
      info: () => {
        const run = this.run;
        const a = this.env.audio;
        return {
          backend: this.driver.graphics?.backend ?? 'none',
          quality: this.driver.qualityLevel,
          empties: run ? emptyCount(run.match.position) : -1,
          turn: run?.activeSide ?? null,
          audio: a.ctx?.state ?? 'none',
          voices: a.activeVoices('sfx') + a.activeVoices('bgm'),
        };
      },
      autoplay: () => this.autoplay,
      setAutoplay: (on) => {
        this.autoplay = on;
      },
      start: (rows, turn, human) => {
        const position = positionFromRows(rows, turn === 'black' ? BLACK : WHITE);
        this.startFrom({ human: human === 'black' ? BLACK : WHITE }, 0, position);
      },
      play: (name) => {
        const run = this.run;
        const square = parseSquare(name);
        if (run && square >= 0 && boardInput(this.state)) run.release(square);
      },
    });
    debugSlot.publish(this, hooks);
  }
}

type DebugSource = {
  info(): ReversiDebugHooks['debugInfo'];
  autoplay(): boolean;
  setAutoplay(on: boolean): void;
  start(rows: readonly string[], turn: 'black' | 'white', human: 'black' | 'white'): void;
  play(square: string): void;
};

class DebugHooks implements ReversiDebugHooks {
  private readonly src: DebugSource;

  constructor(src: DebugSource) {
    this.src = src;
  }

  get debugInfo(): ReversiDebugHooks['debugInfo'] {
    return this.src.info();
  }

  get debugAutoplay(): boolean {
    return this.src.autoplay();
  }

  setDebugAutoplay(on: boolean): void {
    this.src.setAutoplay(on);
  }

  debugStart(rows: readonly string[], turn: 'black' | 'white', human: 'black' | 'white'): void {
    this.src.start(rows, turn, human);
  }

  debugPlay(square: string): void {
    this.src.play(square);
  }
}

/** 開発用の操作口を用意したセッションなら、その操作口。本番ビルドでは null */
export function debugHooksOf(session: SessionHandle): ReversiDebugHooks | null {
  return debugSlot.of(session);
}

/** 対局の乱数の種。暗号用の乱数から 32 ビットを取る */
function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/** ブラウザで動かすときの SessionEnv。描画領域は container */
function browserEnv(container: HTMLElement): SessionEnv {
  return {
    createGraphics: (view, events) =>
      createPostGraphics({ container, scene: view.scene, camera: view.camera, exposure: LOOK.exposure, clearColor: CLEAR_COLOR, events, post: { aberration: true } }),
    createInput: (handlers, now) => new PointerInput(container, handlers, { now }),
    surface: elementSurface(container),
    audio,
    settings: reversiSettings(),
    vibrate,
    randomSeed,
    now: () => performance.now(),
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

