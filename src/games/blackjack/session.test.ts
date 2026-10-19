import { describe, expect, test } from 'bun:test';
import type { PointerHandlers } from '../../engine/pointer.ts';
import type { GraphicsEvents } from '../../engine/render-driver.ts';
import { AudioEngine } from '../../juice/audio/engine.ts';
import { ROUNDS, START_CHIPS } from './scoring.ts';
import { debugHooksOf, startGameSession } from './session.ts';
import type { BlackjackDebugHooks, SessionEnv, SessionGraphics, SessionInput } from './session.ts';
import type { Callout, HudState, RunResult, SessionEvent, SessionHandle } from './types.ts';

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
  setAberration(): void {}
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

/** エンジンへ最後に伝えた一時停止を覚えるエンジン */
class PauseSpyAudio extends AudioEngine {
  enginePaused = false;
  override setPaused(paused: boolean): void {
    super.setPaused(paused);
    this.enginePaused = paused;
  }
}

class FakeInput implements SessionInput {
  readonly handlers: PointerHandlers;
  active = false;
  constructor(handlers: PointerHandlers) {
    this.handlers = handlers;
  }
  setActive(active: boolean): void {
    this.active = active;
  }
  dispose(): void {}
}

const WIDTH = 390;
const HEIGHT = 844;
const HUD = { top: 110, bottom: 150 };

/** 描画・入力・時計を代役にしたセッションを作る。frame() で rAF を 1 回回す（60fps） */
async function setup(opts: { failRecovery?: boolean; audio?: AudioEngine; seed?: number } = {}) {
  let now = 10_000;
  const graphics: FakeGraphics[] = [];
  let events: GraphicsEvents | null = null;
  let input: FakeInput | null = null;
  const sessionEvents: SessionEvent[] = [];
  const huds: HudState[] = [];
  const callouts: Callout[] = [];
  const announcements: string[] = [];
  const env: SessionEnv = {
    createGraphics: async (_view, ev) => {
      if (opts.failRecovery && graphics.length > 0) throw new Error('no adapter');
      const g = new FakeGraphics();
      graphics.push(g);
      events = ev;
      return g;
    },
    createInput: (handlers) => (input = new FakeInput(handlers)),
    surface: { width: WIDTH, height: HEIGHT, observe: () => () => {} },
    audio: opts.audio ?? new AudioEngine(() => null),
    settings: { cameraMotion: { shake: 1, pulse: 1, pull: 1, punch: 1, jolt: 1 }, audio: { sfx: true, bgm: true }, subscribe: () => () => {} },
    vibrate: () => {},
    randomSeed: () => opts.seed ?? 42,
    now: () => now,
    debug: true,
  };
  const session: SessionHandle = await startGameSession(env, {
    onEvent: (e) => sessionEvents.push(e),
    onHud: (s) => huds.push(structuredClone(s)),
    onCallout: (c) => callouts.push(c),
    onAnnounce: (t) => announcements.push(t),
  });
  session.setHudLayout(HUD);
  const hooks: BlackjackDebugHooks | null = debugHooksOf(session);
  if (!hooks || !input) throw new Error('the session did not start');
  const fakeInput: FakeInput = input;
  const h = {
    session,
    hooks,
    input: fakeInput,
    graphics,
    events: sessionEvents,
    huds,
    callouts,
    announcements,
    get hud(): HudState | undefined {
      return huds[huds.length - 1];
    },
    get finished(): RunResult | undefined {
      const e = sessionEvents.find((x) => x.t === 'finished');
      return e?.t === 'finished' ? e.result : undefined;
    },
    frame(ms = 1000 / 60): void {
      now += ms;
      graphics[graphics.length - 1]?.loop?.(now);
    },
    until(cond: () => boolean, maxFrames = 60 * 120): void {
      for (let i = 0; i < maxFrames; i++) {
        if (cond()) return;
        h.frame();
      }
      throw new Error('condition not reached');
    },
    tap(): void {
      const at = now / 1000;
      fakeInput.handlers.onPress(10, 10);
      fakeInput.handlers.onRelease(10, 10, at);
    },
    loseGpu(): void {
      events?.onLost();
    },
    async settle(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
  return h;
}

type Harness = Awaited<ReturnType<typeof setup>>;
const deciding = (h: Harness) => () => h.hooks.debugInfo.deciding;
const betting = (h: Harness) => () => h.hooks.debugInfo.betting;

/** 配るカードを決めて練習のプレイを始め、置いてある賭けで配って、操作を待つまで進める */
function startRound(h: Harness, cards: string[]): void {
  h.hooks.debugStart(cards);
  h.until(betting(h));
  h.session.deal();
}

describe('ブラックジャックの GameSession', () => {
  test('始めると 100 を置いて賭けを選び始め、配ると操作を待って押せるボタンを HUD に出す', async () => {
    const h = await setup();
    h.hooks.debugStart(['10S', '7H', '6D', '9C']);
    expect(h.events.at(-1)).toEqual({ t: 'started' });
    h.until(betting(h));
    h.frame();
    expect(h.hud?.slip).toEqual({ open: true, bet: 100, limit: START_CHIPS });
    expect(h.hud?.round).toBe(1);
    expect(h.hud?.bets[0]).toMatchObject({ shown: true, amount: 100 });
    expect(h.hud?.chips).toBe(START_CHIPS - 100);
    h.session.deal();
    h.until(deciding(h));
    h.frame();
    const hud = h.hud;
    expect(hud?.slip.open).toBe(false);
    expect(hud?.chips).toBe(START_CHIPS - 100);
    expect(hud?.actions).toEqual({ hit: true, stand: true, double: true, split: false });
    expect(hud?.hands[0]).toMatchObject({ shown: true, total: 16, state: 'active' });
    expect(hud?.bets[0]).toMatchObject({ shown: true, amount: 100 });
    expect(hud?.dealer).toMatchObject({ shown: true, total: 7 });
  });

  test('賭けはチップを足して決め、上限で止まる。取り消すと 0 になり、0 では配れない', async () => {
    const h = await setup();
    h.hooks.debugStart(['10S', '7H', '6D', '9C']);
    h.until(betting(h));
    h.session.placeChip(500);
    h.frame();
    expect(h.hud?.slip.bet).toBe(600);
    h.session.placeChip(1000);
    h.frame();
    expect(h.hud?.slip.bet).toBe(START_CHIPS);
    expect(h.hud?.chips).toBe(0);
    h.session.clearBet();
    h.session.deal();
    h.frame();
    expect([h.hud?.slip.bet, h.hooks.debugInfo.betting, h.hud?.chips]).toEqual([0, true, START_CHIPS]);
    h.session.placeChip(10);
    h.session.deal();
    h.until(deciding(h));
    expect(h.hud?.chips).toBe(START_CHIPS - 10);
  });

  test('すべて賭けると手持ちをすべて賭けに置き、すべて置いていればそれ以上は増やさない', async () => {
    const h = await setup();
    h.hooks.debugStart(['10S', '7H', '6D', '9C']);
    h.until(betting(h));
    h.session.allIn();
    h.frame();
    expect([h.hud?.slip.bet, h.hud?.chips]).toEqual([START_CHIPS, 0]);
    h.session.allIn();
    h.frame();
    expect([h.hud?.slip.bet, h.hud?.chips]).toEqual([START_CHIPS, 0]);
    h.session.deal();
    h.until(deciding(h));
    expect(h.hud?.chips).toBe(0);
  });

  test('賭けを選んでいない間の賭けのボタンは受け付けない', async () => {
    const h = await setup();
    startRound(h, ['10S', '7H', '6D', '9C']);
    h.session.placeChip(1000);
    h.session.allIn();
    h.session.clearBet();
    h.session.deal();
    h.until(deciding(h));
    expect(h.hud?.chips).toBe(START_CHIPS - 100);
  });

  test('止めると、ディーラーが引き、精算して、チップが手持ちへ戻ってから次のラウンドを配る', async () => {
    const h = await setup();
    // プレイヤー 20 対ディーラー 17（6 + K = 16 から A でソフト 17）
    startRound(h, ['10S', '6H', 'QD', 'KC', 'AS']);
    h.until(deciding(h));
    h.session.act('stand');
    // チップは 1 枚ずつ手持ちへ戻り、戻るたびに HUD の手持ちが増える
    h.until(() => (h.hud?.chips ?? 0) > START_CHIPS - 100);
    expect(h.hud?.chips).toBeLessThan(START_CHIPS + 100);
    h.until(() => h.hud?.chips === START_CHIPS + 100);
    expect(h.callouts.some((c) => c.kind === 'payout' && c.total === 100)).toBe(true);
    // 次のラウンドは、前の賭けを置いて賭けを選び始める
    h.until(betting(h));
    h.frame();
    expect([h.hud?.round, h.hud?.slip.bet]).toEqual([2, 100]);
    h.session.deal();
    h.until(deciding(h));
    expect(h.hooks.debugInfo.rounds).toBe(2);
  });

  test('操作を待つ直前に押した操作は覚えておき、待ち始めた瞬間に選ぶ', async () => {
    const h = await setup();
    h.hooks.debugStart(['10S', '6H', 'QD', 'KC', 'AS']);
    h.until(betting(h));
    h.session.deal();
    // 操作を待つ 1 フレーム前まで進めてから押す
    h.until(() => {
      h.session.act('stand');
      return h.hooks.debugInfo.deciding || h.callouts.some((c) => c.kind === 'payout');
    });
    h.until(() => h.callouts.some((c) => c.kind === 'payout'));
    expect(h.callouts.find((c) => c.kind === 'payout')).toMatchObject({ total: 100 });
  });

  test('操作を待っていない間の操作と、選べない操作は受け付けない', async () => {
    const h = await setup();
    startRound(h, ['10S', '7H', '6D', '9C']);
    h.session.act('hit');
    h.until(deciding(h));
    h.frame();
    expect(h.hud?.hands[0].total).toBe(16);
    h.session.act('split');
    h.frame();
    expect(h.hud?.hands[1].shown).toBe(false);
    expect(h.hooks.debugInfo.deciding).toBe(true);
  });

  test('ブラックジャックは 3:2 で払い、知らせる', async () => {
    const h = await setup();
    startRound(h, ['AS', '6H', 'KD', '9C']);
    h.until(() => h.callouts.some((c) => c.kind === 'blackjack'));
    h.until(() => (h.hud?.chips ?? 0) === START_CHIPS + 150);
    expect(h.announcements).toContain('ブラックジャック');
  });

  test('バーストするとその場で賭けを取られる', async () => {
    const h = await setup();
    startRound(h, ['10S', '6H', '6D', '5C', 'KH']);
    h.until(deciding(h));
    h.session.act('hit');
    h.until(() => h.callouts.some((c) => c.kind === 'loss'));
    expect(h.announcements.some((t) => t.startsWith('バースト'))).toBe(true);
    // 次の賭けを選び始めると、前の賭け（100）を手持ちから置く
    h.until(betting(h));
    h.frame();
    expect(h.hud?.chips).toBe(START_CHIPS - 200);
  });

  test('分けると手が 2 つになり、それぞれの合計の札を出す', async () => {
    const h = await setup();
    startRound(h, ['8S', '9H', '8D', '7C', '3H', '10C']);
    h.until(deciding(h));
    h.session.act('split');
    h.until(deciding(h));
    h.frame();
    expect(h.hud?.hands.slice(0, 2).map((l) => [l.shown, l.state])).toEqual([
      [true, 'active'],
      [true, 'waiting'],
    ]);
    expect(h.hud?.chips).toBe(START_CHIPS - 200);
    expect(h.hud?.bets.slice(0, 2).map((b) => b.amount)).toEqual([100, 100]);
  });

  test('自動で打つと決まったラウンドの数を配りきって終わりの儀式を見せ、結果が確定する。内訳の合計は最後の手持ち', async () => {
    const h = await setup({ seed: 7 });
    h.session.start(0);
    h.hooks.setDebugAutoplay(true);
    h.until(() => h.events.some((e) => e.t === 'runEnding'), 60 * 60 * 10);
    expect(h.callouts.filter((c) => c.kind === 'finalRound')).toHaveLength(1);
    h.until(() => h.finished !== undefined, 60 * 30);
    const r = h.finished as RunResult;
    expect(r.score.total).toBe(r.score.start + r.score.won + r.score.bonus - r.score.lost);
    expect(r.rounds).toBe(ROUNDS);
    expect(h.hud?.chips).toBe(r.score.total);
    expect(r.practice).toBe(false);
  });

  test('終わりの儀式はタップで飛ばせる', async () => {
    const h = await setup({ seed: 3 });
    h.session.start(0);
    h.hooks.setDebugAutoplay(true);
    h.until(() => h.events.some((e) => e.t === 'runEnding'), 60 * 60 * 10);
    h.frame();
    h.tap();
    expect(h.finished).toBeDefined();
    expect(h.callouts.some((c) => c.kind === 'verdict')).toBe(true);
  });

  test('一時停止中は世界も音も止まり、操作も受け付けない', async () => {
    const audio = new PauseSpyAudio(() => null);
    const h = await setup({ audio });
    startRound(h, ['10S', '7H', '6D', '9C']);
    h.until(deciding(h));
    h.session.setPaused(true);
    expect(audio.enginePaused).toBe(true);
    h.session.act('stand');
    for (let i = 0; i < 60; i++) h.frame();
    expect(h.hooks.debugInfo.deciding).toBe(true);
    h.session.setPaused(false);
    expect(audio.enginePaused).toBe(false);
  });

  test('GPU を失ったら描画一式を作り直して続け、作り直せなければ lost を知らせる', async () => {
    const ok = await setup();
    ok.session.start(0);
    ok.loseGpu();
    await ok.settle();
    expect(ok.graphics.length).toBe(2);
    ok.frame();
    expect(ok.events.some((e) => e.t === 'fatal')).toBe(false);
    const bad = await setup({ failRecovery: true });
    bad.loseGpu();
    await bad.settle();
    expect(bad.events.at(-1)).toMatchObject({ t: 'fatal', cause: 'lost' });
  });

  test('手持ちをすべて賭けて負けると、破産して終わる', async () => {
    const h = await setup();
    h.hooks.debugStart(['10S', '10H', '7D', 'QC']);
    h.until(betting(h));
    h.session.placeChip(1000);
    h.session.deal();
    h.until(deciding(h));
    h.session.act('stand');
    h.until(() => h.finished !== undefined, 60 * 60);
    expect(h.finished).toMatchObject({ outcome: 'broke', rounds: 1 });
  });

  test('練習のプレイ（配るカードを決めて始めたプレイ）は、結果に練習と書く', async () => {
    const h = await setup();
    h.hooks.debugStart(['AS', '6H', 'KD', '9C']);
    h.hooks.setDebugAutoplay(true);
    h.until(() => h.finished !== undefined, 60 * 60 * 12);
    expect(h.finished?.practice).toBe(true);
  });
});
