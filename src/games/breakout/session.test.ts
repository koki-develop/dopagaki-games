import { describe, expect, test } from 'bun:test';
import { AudioEngine } from '../../juice/audio/engine.ts';
import { snapshotTuning } from './config.ts';
import { debugHooksOf, startGameSession } from './session.ts';
import type { BreakoutDebugHooks, GraphicsEvents, InputHandlers, SessionEnv, SessionGraphics, SessionInput } from './session.ts';
import type { StageDef } from './sim/stage-parse.ts';
import { STAGES } from './stages/stages.ts';
import type { HudState, SessionEvent, SessionHandle } from './types.ts';

/** パドルの真上の 2 個だけのステージ。発射したボールが数秒でクリアする */
const SHORT_STAGE: StageDef = { id: 'short', name: 'SHORT', rows: ['.....oo.....'] };
const SHORT = { kind: 'stage', index: 0 } as const;

class FakeGraphics implements SessionGraphics {
  readonly backend = 'fake';
  readonly host = null;
  loop: ((time?: number) => void) | null = null;
  renders = 0;
  disposed = false;
  setAnimationLoop(cb: ((time?: number) => void) | null): void {
    this.loop = cb;
  }
  render(): void {
    this.renders++;
  }
  setBloom(): void {}
  setSize(): void {}
  setQuality(): void {}
  async warmUp(): Promise<void> {
    this.renders++;
  }
  dispose(): void {
    this.disposed = true;
    this.loop = null;
  }
}

class FakeInput implements SessionInput {
  handlers: InputHandlers;
  now: () => number;
  active = false;
  keyDirection = 0;
  constructor(handlers: InputHandlers, now: () => number) {
    this.handlers = handlers;
    this.now = now;
  }
  setActive(active: boolean): void {
    this.active = active;
  }
  dispose(): void {}
  /** 押した時刻（秒）を指定して離す */
  release(pressedAt: number): void {
    this.handlers.onRelease({ pressedAt });
  }
}

type SetupOptions = {
  /** 2 回目以降（GPU を失った後）の描画一式の作成を失敗させる */
  failRecovery?: boolean;
  onEvent?: (e: SessionEvent, session: SessionHandle) => void;
  onHud?: (s: HudState) => void;
};

/** 描画・入力・時計を代役にしたセッションを作る。frame() で rAF を 1 回回す（60fps） */
async function setup(opts: SetupOptions = {}) {
  let now = 10_000;
  const graphics: FakeGraphics[] = [];
  let events: GraphicsEvents | null = null;
  let input: FakeInput | null = null;
  const sessionEvents: SessionEvent[] = [];
  const huds: HudState[] = [];
  let session: SessionHandle | null = null;
  const env: SessionEnv = {
    createGraphics: async (_view, ev) => {
      if (opts.failRecovery && graphics.length > 0) throw new Error('no adapter');
      const g = new FakeGraphics();
      graphics.push(g);
      events = ev;
      return g;
    },
    createInput: (handlers, clock) => (input = new FakeInput(handlers, clock)),
    surface: { width: 390, height: 844, observe: () => () => {} },
    audio: new AudioEngine(() => null),
    settings: { get: () => ({ shake: true }), cameraMotionScale: 1, subscribe: () => () => {} },
    vibrate: () => {},
    randomSeed: () => 42,
    now: () => now,
    stages: [SHORT_STAGE, ...STAGES],
    config: snapshotTuning,
    debug: true,
  };
  session = await startGameSession(env, {
    onEvent: (e) => {
      sessionEvents.push(e);
      if (session) opts.onEvent?.(e, session);
    },
    onHud: (s) => {
      huds.push({ ...s });
      opts.onHud?.(s);
    },
  });
  const s = session;
  const hooks: BreakoutDebugHooks | null = debugHooksOf(s);
  if (!hooks || !input) throw new Error('the session did not start');
  const fakeInput: FakeInput = input;
  return {
    session: s,
    hooks,
    input: fakeInput,
    graphics,
    events: sessionEvents,
    huds,
    get current(): FakeGraphics | undefined {
      return graphics[graphics.length - 1];
    },
    /** 今の時刻（秒、入力の押した時刻と同じ時間軸） */
    get nowSeconds(): number {
      return now / 1000;
    },
    frame(ms = 1000 / 60): void {
      now += ms;
      graphics[graphics.length - 1]?.loop?.(now);
    },
    /** cond が真になるまでフレームを回す */
    until(cond: () => boolean, maxFrames = 60 * 30): void {
      for (let i = 0; i < maxFrames; i++) {
        if (cond()) return;
        this.frame();
      }
      throw new Error('condition not reached');
    },
    loseGpu(): void {
      events?.onLost();
    },
  };
}

type Harness = Awaited<ReturnType<typeof setup>>;

/** ステージを用意して始め、ボールを発射する */
function startShortStage(h: Harness): void {
  h.session.prepare(SHORT, 10);
  h.frame();
  h.session.begin();
  h.hooks.setDebugAutoplay(true);
}

const names = (events: SessionEvent[]) => events.map((e) => e.t);
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('GameSession: 起動と描画', () => {
  test('描画の準備が済んだら解決し、リフレッシュ間隔の実測を待たずに最初のフレームから描く', async () => {
    const h = await setup();
    const g = h.current;
    expect(g?.renders).toBe(1);
    h.frame();
    expect(g?.renders).toBe(2);
    // 何も変わらないタイトルは描き直さない
    for (let i = 0; i < 10; i++) h.frame();
    expect(g?.renders).toBe(2);
    h.session.dispose();
    expect(g?.disposed).toBe(true);
  });

  test('プレイ中は毎フレーム描き、一時停止したら 1 回描いて止まる', async () => {
    const h = await setup();
    startShortStage(h);
    const g = h.current;
    const before = g?.renders ?? 0;
    for (let i = 0; i < 5; i++) h.frame();
    expect(g?.renders).toBe(before + 5);
    h.session.setPaused(true);
    h.frame();
    const paused = g?.renders ?? 0;
    for (let i = 0; i < 5; i++) h.frame();
    expect(g?.renders).toBe(paused);
    expect(h.hooks.running).toBe(false);
  });
});

describe('GameSession: プレイの節目', () => {
  test('勝敗が決まったら runEnding、結果が確定したら finished を、この順に 1 回ずつ知らせる', async () => {
    const h = await setup();
    startShortStage(h);
    h.until(() => h.events.length >= 2);
    for (let i = 0; i < 120; i++) h.frame();
    expect(names(h.events)).toEqual(['runEnding', 'finished']);
    const finished = h.events[1];
    expect(finished).toMatchObject({ t: 'finished', result: { mode: SHORT, cleared: true, previousBest: 10, newBest: true } });
    expect(h.huds.at(-1)?.score).toBe(finished.t === 'finished' ? finished.result.score : -1);
    expect(h.huds.every((s) => s.runId === 1)).toBe(true);
  });

  test('知らせを受けた先で次のプレイを用意したら、前のプレイの節目はもう知らせない', async () => {
    const h = await setup({
      onEvent: (e, session) => {
        if (e.t === 'runEnding') session.prepare({ kind: 'endless' }, 0);
      },
    });
    startShortStage(h);
    h.until(() => h.events.length > 0);
    for (let i = 0; i < 60 * 5; i++) h.frame();
    expect(names(h.events)).toEqual(['runEnding']);
    // 新しいプレイは準備中のまま（入力を受け付けない）
    expect(h.input.active).toBe(false);
    expect(h.huds.at(-1)?.runId).toBe(2);
  });

  test('endRun の後は、捨てたプレイの節目を知らせず、HUD も送らない', async () => {
    const h = await setup();
    startShortStage(h);
    for (let i = 0; i < 10; i++) h.frame();
    h.session.endRun();
    const huds = h.huds.length;
    for (let i = 0; i < 60 * 5; i++) h.frame();
    expect(h.events).toEqual([]);
    expect(h.huds.length).toBe(huds);
    expect(h.hooks.debugInfo.balls).toBe(0);
  });
});

describe('GameSession: 離した入力', () => {
  test('準備中は発射せず、プレイ中は発射する', async () => {
    const h = await setup();
    h.session.prepare(SHORT, 0);
    h.frame();
    h.input.release(h.nowSeconds);
    h.frame();
    expect(h.hooks.debugInfo.balls).toBe(0);
    expect(h.input.active).toBe(false);
    h.session.begin();
    expect(h.input.active).toBe(true);
    h.input.release(h.nowSeconds);
    h.frame();
    expect(h.hooks.debugInfo.balls).toBe(1);
  });

  test('勝敗が決まった後は、その後に押したものだけが演出を飛ばす。押した時刻と勝敗の時刻は同じ時計', async () => {
    const h = await setup();
    // 入力の押した時刻を測る時計は、セッションの時計そのもの
    expect(h.input.now()).toBe(h.nowSeconds * 1000);
    startShortStage(h);
    h.until(() => h.events.length > 0);
    const endingAt = h.nowSeconds;
    expect(h.hooks.debugInfo.phase).toBe('cleared');
    const bonus = h.hooks.debugInfo.bonusLeft;
    expect(bonus).toBeGreaterThan(0);
    // 勝敗が決まる前（同じ時刻を含む）に押したものは飛ばさない
    h.input.release(endingAt - 0.2);
    h.input.release(endingAt);
    expect(h.hooks.debugInfo.bonusLeft).toBe(bonus);
    h.frame();
    expect(names(h.events)).toEqual(['runEnding']);
    // 後に押したものは飛ばし、残りのボーナスをまとめて加える
    h.input.release(endingAt + 0.001);
    expect(h.hooks.debugInfo.bonusLeft).toBe(0);
    h.frame();
    expect(names(h.events)).toEqual(['runEnding', 'finished']);
    // 結果が確定した後は入力を受け付けない
    expect(h.input.active).toBe(false);
  });
});

describe('GameSession: 致命的な失敗', () => {
  test('フレームの処理で例外が投げられたら、ループを止め、internal を 1 回だけ知らせ、以後の命令は何もしない', async () => {
    let throwOnHud = false;
    const h = await setup({
      onHud: () => {
        if (throwOnHud) throw new Error('hud broke');
      },
    });
    startShortStage(h);
    h.frame();
    const g = h.current;
    const loop = g?.loop;
    throwOnHud = true;
    h.frame();
    throwOnHud = false;
    expect(h.events).toEqual([{ t: 'fatal', cause: 'internal', message: 'hud broke' }]);
    expect(g?.loop).toBeNull();
    expect(h.input.active).toBe(false);
    const renders = g?.renders;
    const huds = h.huds.length;
    loop?.(1e9);
    h.session.prepare({ kind: 'endless' }, 0);
    h.session.begin();
    h.session.setPaused(true);
    h.session.endRun();
    h.frame();
    expect(g?.renders).toBe(renders);
    expect(h.huds.length).toBe(huds);
    expect(h.events.length).toBe(1);
    h.session.dispose();
  });

  test('GPU を失って作り直せなかったら、lost を 1 回だけ知らせる', async () => {
    const h = await setup({ failRecovery: true });
    startShortStage(h);
    h.frame();
    h.loseGpu();
    await flush();
    expect(h.events).toEqual([{ t: 'fatal', cause: 'lost', message: 'no adapter' }]);
    expect(h.graphics[0].disposed).toBe(true);
    expect(h.input.active).toBe(false);
    h.loseGpu();
    await flush();
    expect(h.events.length).toBe(1);
  });

  test('GPU を失っても作り直せれば、同じプレイを続ける', async () => {
    const h = await setup();
    startShortStage(h);
    for (let i = 0; i < 10; i++) h.frame();
    const score = h.hooks.debugInfo.score;
    h.loseGpu();
    await flush();
    expect(h.graphics.length).toBe(2);
    expect(h.graphics[0].disposed).toBe(true);
    const g = h.graphics[1];
    expect(g.loop).not.toBeNull();
    h.until(() => h.events.length >= 2);
    expect(names(h.events)).toEqual(['runEnding', 'finished']);
    expect(h.hooks.debugInfo.score).toBeGreaterThanOrEqual(score);
    expect(g.renders).toBeGreaterThan(1);
  });
});
