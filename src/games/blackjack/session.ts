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
import { CardField } from './fx/cards.ts';
import { ChipField } from './fx/chips.ts';
import type { PxProjector } from './fx/director.ts';
import { createFxState } from './fx/fx-state.ts';
import type { FxState } from './fx/fx-state.ts';
import { computeLayout, toPxX, toPxY } from './geometry.ts';
import type { Layout } from './geometry.ts';
import type { BetChip } from './denominations.ts';
import { parseCard } from './rules/cards.ts';
import type { Card } from './rules/cards.ts';
import type { Action } from './rules/round.ts';
import { Run } from './run.ts';
import type { RunServices } from './run.ts';
import { IDLE, inputActive, reduceSession, releaseSkips, tableInput, worldAdvances } from './session-state.ts';
import type { SessionAction, SessionState } from './session-state.ts';
import { blackjackSettings } from './settings.ts';
import { createBlackjackBgm } from './sounds/bgm.ts';
import { basicAction } from './strategy/basic.ts';
import type { Callout, HudLayout, SessionCallbacks, SessionHandle } from './types.ts';
import { LOOK } from './view/look.ts';
import { BlackjackView } from './view/scene.ts';
import type { PostTarget } from './view/scene.ts';

/** 描画前に塗りつぶす色（背景のいちばん暗い色） */
const CLEAR_COLOR = 0x010406;

/** 描画一式（本番では RenderHost と PostChain）。GPU を失ったら、RenderDriver が捨てて作り直す */
export type SessionGraphics = DriverGraphics & PostTarget;

/** 卓への入力（本番では PointerInput）。終わりの儀式を飛ばすタップに使う */
export type SessionInput = {
  setActive(active: boolean): void;
  dispose(): void;
};

/** セッションが外から受け取るもの。本番ではブラウザのもの（browserEnv）、テストでは代役を渡す */
export type SessionEnv = {
  /** 描画一式を作る。view のシーンを描く */
  createGraphics(view: BlackjackView, events: GraphicsEvents): Promise<SessionGraphics>;
  /** 入力を受け始める。now は押した時刻を測る時計（ms） */
  createInput(handlers: PointerHandlers, now: () => number): SessionInput;
  surface: Surface;
  audio: AudioEngine;
  settings: SessionSettings;
  vibrate(pattern: number | readonly number[]): void;
  /** プレイの乱数の種（32 ビット）。シューを混ぜるのに使う */
  randomSeed(): number;
  /** 今の時刻（ms、performance.now() の時間軸）。入力の押した時刻と儀式を始めた時刻は、この時計で測る */
  now(): number;
  /** 開発用の操作口（debugHooksOf と window.__blackjack）を用意する */
  debug: boolean;
};

/** 開発ビルドで window.__blackjack に置く操作口。調整パネルと、ブラウザの開発者ツールから使う */
export type BlackjackDebugHooks = {
  readonly debugInfo: {
    backend: string;
    quality: number;
    /** 配ったラウンドの数と、シューの配った枚数。プレイがなければ -1 */
    rounds: number;
    dealt: number;
    betting: boolean;
    deciding: boolean;
    audio: AudioContextState | 'none';
    voices: number;
  };
  readonly debugAutoplay: boolean;
  /** 操作を待っていたらベーシックストラテジーですぐに選び、賭けを選んでいたら置いている賭けで配る（ボタンの代わりをするだけで、ラウンドには直接触らない） */
  setDebugAutoplay(on: boolean): void;
  /**
   * シューの先頭に cards（"AS"、"10H" のような表記）を置いて、プレイを始める。配る順はプレイヤー → ディーラー（表）→ プレイヤー → ディーラー（伏せる）→ 引く順。
   * 演出を確かめるのに使う。このプレイは練習として、記録にも最高スコアの更新にも数えない
   */
  debugStart(cards: readonly string[]): void;
  /** 操作のボタンを押したのと同じ */
  debugAct(action: Action): void;
  /** 配るボタンを押したのと同じ */
  debugDeal(): void;
};

declare global {
  interface Window {
    __blackjack?: BlackjackDebugHooks;
  }
}

/** 開発ビルドで window.__blackjack に置く操作口 */
const debugSlot = new DebugHookSlot<BlackjackDebugHooks>('__blackjack');

/** 何もない卓。タイトルの背景に使う。世界は進めない */
type IdleScene = { readonly fx: FxState; readonly cards: CardField; readonly chips: ChipField };

const createIdleScene = (): IdleScene => ({ fx: createFxState(), cards: new CardField(), chips: new ChipField() });

/**
 * ブラックジャックの画面が表示されている間だけ生きている、ゲーム本体。
 *
 * 描画一式とフレームのループ（RenderDriver）・入力・BGM・フラッシュの制限・present の時計を持ち、
 * start のたびに新しいプレイ（Run）を作る。入力を受け付けるか、世界を進めるかは、状態（SessionState）だけから決める。
 *
 * フレームの処理で例外が投げられたら、プレイを捨てて、致命的な失敗（internal）を 1 回だけ知らせる。
 * GPU を失って作り直せなかったときは lost を知らせる。どちらの後も、命令は何もしない。
 */
class GameSession implements SessionHandle {
  private readonly env: SessionEnv;
  private readonly cb: SessionCallbacks;
  private readonly view = new BlackjackView();
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
  private readonly px: PxProjector = {
    x: (wx) => toPxX(this.layout, wx),
    y: (wy) => toPxY(this.layout, wy),
  };
  private state: SessionState = IDLE;
  private run: Run | null = null;
  private idle: IdleScene = createIdleScene();
  private layout: Layout = computeLayout(1, 1, 0, 0);
  private hudLayout: HudLayout = { top: 0, bottom: 0 };
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
    this.bgm = createBlackjackBgm(env.audio);
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
      px: this.px,
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

  /**
   * 描画の準備（パイプラインのコンパイルと最初の描画）と、カードの表の絵の読み込みが済んだら解決する。
   * AudioContext もその間に作っておく。絵を読み込めなければ LoadError で失敗する
   */
  static async create(env: SessionEnv, cb: SessionCallbacks): Promise<GameSession> {
    const s = new GameSession(env, cb);
    try {
      const attached = s.driver.start();
      const prepared = s.view.prepare();
      // AudioContext を作る重い処理を、GPU の初期化を待つ間に済ませる。最初のタップで固まらないように
      env.audio.preload();
      await Promise.all([attached, prepared]);
    } catch (e) {
      s.dispose();
      throw e;
    }
    if (s.disposed) throw new Error('GameSession was disposed while starting');
    if (env.debug) s.installDebugHooks();
    return s;
  }

  // ---- GamePort ----

  start(bestScore: number): void {
    this.startWith(bestScore, null);
  }

  /** start と同じ。top を渡すと、シューの先頭にそのカードを置いた練習のプレイを始める（開発用の操作口だけが渡す） */
  private startWith(bestScore: number, top: readonly Card[] | null): void {
    if (!this.alive) return;
    this.env.audio.unlock();
    const run = new Run({
      id: this.nextRunId++,
      top,
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
    this.cb.onEvent({ t: 'started' });
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

  act(action: Action): void {
    const run = this.run;
    if (!this.alive || !run || !tableInput(this.state)) return;
    run.act(action);
    this.invalidate();
  }

  placeChip(value: BetChip): void {
    const run = this.run;
    if (!this.alive || !run || !tableInput(this.state)) return;
    run.placeChip(value);
    this.invalidate();
  }

  allIn(): void {
    const run = this.run;
    if (!this.alive || !run || !tableInput(this.state)) return;
    run.allIn();
    this.invalidate();
  }

  clearBet(): void {
    const run = this.run;
    if (!this.alive || !run || !tableInput(this.state)) return;
    run.clearBet();
    this.invalidate();
  }

  deal(): void {
    const run = this.run;
    if (!this.alive || !run || !tableInput(this.state)) return;
    run.deal();
    this.invalidate();
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
    this.invalidate();
    return true;
  }

  /** 今のプレイを捨て、何もない卓へ戻す */
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

  /** 卓のタップとキーは、終わりの儀式を飛ばすのにだけ使う（操作はボタンとキーから act で届く） */
  private readonly handlers: PointerHandlers = {
    onPress: () => {},
    onMove: () => {},
    onRelease: (_x, _y, pressedAt) => this.trySkip(pressedAt),
    onCancel: () => {},
    onKeyMove: () => {},
    onKeyConfirm: (pressedAt) => this.trySkip(pressedAt),
  };

  private trySkip(pressedAt: number): void {
    const run = this.run;
    if (run && releaseSkips(this.state, pressedAt) && run.skip()) this.emitSignals(run);
  }

  /** 開発用: 賭けを選んでいたら置いている賭けで配り、操作を待っていたらベーシックストラテジーですぐに選ぶ */
  private driveAutoplay(run: Run): void {
    if (!this.autoplay || !tableInput(this.state)) return;
    if (run.betting) {
      run.deal();
      return;
    }
    const r = run.round;
    if (!run.deciding || !r || r.active < 0) return;
    const h = r.hands[r.active];
    run.act(basicAction(h.cards, r.dealer[0], { double: r.can('double'), split: r.can('split') }));
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
  private draw(): void {
    const view = this.view;
    const run = this.run;
    if (run) {
      const motion = this.env.settings.cameraMotion;
      run.camera.sample(motion, this.camOut);
      view.apply(run.fx, run.frameTime, motion.jolt);
      view.sync(run.cards, run.chips, this.camOut);
      return;
    }
    const t = this.idleTime;
    t.real = this.real;
    t.present = this.present;
    view.apply(this.idle.fx, t, 0);
    view.sync(this.idle.cards, this.idle.chips, this.idleCam);
  }

  /** 卓の上の文字を、位置をワールド座標から描画領域の CSS ピクセルへ直して画面へ渡す */
  private emitCallout(c: Callout): void {
    const l = this.layout;
    const out: Callout = 'x' in c ? { ...c, x: toPxX(l, c.x), y: toPxY(l, c.y) } : c;
    this.cb.onCallout(out);
  }

  // ---- 描画先 ----

  /** 描画領域と HUD の配置から、卓の配置を決め直す */
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
          rounds: run ? run.table.rounds : -1,
          dealt: run ? run.table.shoe.dealt : -1,
          betting: run?.betting ?? false,
          deciding: run?.deciding ?? false,
          audio: a.ctx?.state ?? 'none',
          voices: a.activeVoices('sfx') + a.activeVoices('bgm'),
        };
      },
      autoplay: () => this.autoplay,
      setAutoplay: (on) => {
        this.autoplay = on;
      },
      start: (names) => {
        const top = names.map(parseCard);
        if (top.some((c) => c < 0)) throw new Error(`unreadable card in ${names.join(', ')}`);
        this.startWith(0, top);
      },
      act: (action) => this.act(action),
      deal: () => this.deal(),
    });
    debugSlot.publish(this, hooks);
  }
}

type DebugSource = {
  info(): BlackjackDebugHooks['debugInfo'];
  autoplay(): boolean;
  setAutoplay(on: boolean): void;
  start(cards: readonly string[]): void;
  act(action: Action): void;
  deal(): void;
};

class DebugHooks implements BlackjackDebugHooks {
  private readonly src: DebugSource;

  constructor(src: DebugSource) {
    this.src = src;
  }

  get debugInfo(): BlackjackDebugHooks['debugInfo'] {
    return this.src.info();
  }

  get debugAutoplay(): boolean {
    return this.src.autoplay();
  }

  setDebugAutoplay(on: boolean): void {
    this.src.setAutoplay(on);
  }

  debugStart(cards: readonly string[]): void {
    this.src.start(cards);
  }

  debugAct(action: Action): void {
    this.src.act(action);
  }

  debugDeal(): void {
    this.src.deal();
  }
}

/** 開発用の操作口を用意したセッションなら、その操作口。本番ビルドでは null */
export function debugHooksOf(session: SessionHandle): BlackjackDebugHooks | null {
  return debugSlot.of(session);
}

/** プレイの乱数の種。暗号用の乱数から 32 ビットを取る */
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
    settings: blackjackSettings(),
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
