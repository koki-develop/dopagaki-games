import { describe, expect, test } from 'bun:test';
import type { PointerHandlers } from '../../engine/pointer.ts';
import type { GraphicsEvents } from '../../engine/render-driver.ts';
import { AudioEngine } from '../../juice/audio/engine.ts';
import { cellX, cellY, computeLayout, toPxX, toPxY } from './geometry.ts';
import { COMBO_WINDOW } from './combo.ts';
import { BLACK, parseSquare, WHITE } from './rules/position.ts';
import { sheetOf } from './result.test-support.ts';
import { scoreMove } from './scoring.ts';
import { debugHooksOf, startGameSession } from './session.ts';
import type { ReversiDebugHooks, SessionEnv, SessionGraphics, SessionInput } from './session.ts';
import type { Callout, HudState, MatchSetup, SessionEvent, SessionHandle } from './types.ts';

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
const HUD = { top: 90, bottom: 60 };

/** 描画・入力・時計を代役にしたセッションを作る。frame() で rAF を 1 回回す（60fps） */
async function setup(opts: { failRecovery?: boolean; audio?: AudioEngine } = {}) {
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
    randomSeed: () => 42,
    now: () => now,
    debug: true,
  };
  const session: SessionHandle = await startGameSession(env, {
    onEvent: (e) => sessionEvents.push(e),
    onHud: (s) => huds.push({ ...s }),
    onCallout: (c) => callouts.push(c),
    onAnnounce: (t) => announcements.push(t),
  });
  session.setHudLayout(HUD);
  const hooks: ReversiDebugHooks | null = debugHooksOf(session);
  if (!hooks || !input) throw new Error('the session did not start');
  const fakeInput: FakeInput = input;
  const layout = computeLayout(WIDTH, HEIGHT, HUD.top, HUD.bottom);
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
    /** 今の時刻（秒、入力の押した時刻と同じ時間軸） */
    get nowSeconds(): number {
      return now / 1000;
    },
    /** 1 フレーム進める */
    frame(ms = 1000 / 60): void {
      now += ms;
      graphics[graphics.length - 1]?.loop?.(now);
    },
    /** cond が真になるまでフレームを回す */
    until(cond: () => boolean, maxFrames = 60 * 60): void {
      for (let i = 0; i < maxFrames; i++) {
        if (cond()) return;
        h.frame();
      }
      throw new Error('condition not reached');
    },
    /** マス name の中心を、押して離す */
    tap(name: string): void {
      const s = parseSquare(name);
      const x = toPxX(layout, cellX(s));
      const y = toPxY(layout, cellY(s));
      const at = now / 1000;
      fakeInput.handlers.onPress(x, y);
      fakeInput.handlers.onRelease(x, y, at);
    },
    loseGpu(): void {
      events?.onLost();
    },
    /** 描画一式の作り直し（非同期）が済むのを待つ */
    async settle(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
  return h;
}

type Harness = Awaited<ReturnType<typeof setup>>;

/** 今打てる側（人は打てる状態、CPU は考えている状態）。演出の間は null */
const turnOf = (h: Harness) => h.hooks.debugInfo.turn;
const humanTurn = (h: Harness) => () => turnOf(h) === 'human';

function start(h: Harness, match: MatchSetup = { human: BLACK }): void {
  h.session.start(match, 0);
  h.until(humanTurn(h));
}

describe('リバーシの GameSession', () => {
  test('始めると初期配置が並び、人の手番になると盤への入力を受け付ける', async () => {
    const h = await setup();
    h.session.start({ human: BLACK }, 0);
    expect(h.input.active).toBe(true);
    h.until(humanTurn(h));
    expect([h.hud?.black, h.hud?.white]).toEqual([2, 2]);
  });

  test('盤の打てるマスを押して離すと打ち、CPU が打ち返して人の手番に戻る', async () => {
    const h = await setup();
    start(h);
    h.tap('f5');
    h.until(() => turnOf(h) === 'cpu');
    h.until(humanTurn(h));
    expect(h.announcements[0]).toBe('あなた: f5、1 枚返しました');
    expect(h.announcements[1]).toMatch(/^CPU: [a-h][1-8]、1 枚返しました$/);
    expect((h.hud?.black ?? 0) + (h.hud?.white ?? 0)).toBe(6);
  });

  test('手番が来てから窓の中で打ち続けるとコンボが積まれて置いた石に出る。窓を過ぎると途切れ、次の手から数え直す', async () => {
    const h = await setup();
    start(h);
    const combos = () => h.callouts.flatMap((c) => (c.kind === 'combo' ? [c.count] : []));
    // コンボがないうちは、ゲージを出さない
    h.frame();
    expect(h.hud?.comboWindow).toBe(0);
    h.tap('f5');
    h.until(() => turnOf(h) === 'cpu');
    h.until(humanTurn(h));
    h.frame();
    expect(h.hud?.score).toBeGreaterThan(0);
    // コンボが 1 になったら、次へつなぐ窓をゲージに出す
    expect(h.hud?.comboWindow).toBeGreaterThan(0.9);
    // 2 手目も窓の中で打つ
    h.hooks.setDebugAutoplay(true);
    h.frame();
    h.hooks.setDebugAutoplay(false);
    h.until(() => combos().length > 0);
    expect(combos()).toEqual([2]);
    h.until(() => turnOf(h) === 'cpu');
    h.until(humanTurn(h));
    for (let i = 0; i < Math.ceil(COMBO_WINDOW * 60) + 5; i++) h.frame();
    expect(h.hud?.comboWindow).toBe(0);
    h.hooks.setDebugAutoplay(true);
    h.frame();
    h.hooks.setDebugAutoplay(false);
    for (let i = 0; i < 60; i++) h.frame();
    // 途切れた後の手はコンボ 1 なので数は出さず、次の手番で次へつなぐ窓をゲージに出す
    expect(combos()).toEqual([2]);
    h.until(humanTurn(h));
    h.frame();
    expect(h.hud?.comboWindow).toBeGreaterThan(0.9);
  });

  test('CPU がパスしたら、待たずに人の手番になる', async () => {
    const h = await setup();
    // 黒が a3 に打つと白（CPU）がパスし、黒は h8 に打てる
    h.hooks.debugStart(['OOOOOXXO', 'XOOOXXXO', '.OXXOXXO', 'OOOOOXOO', 'OOOXOOXO', 'XXOXOOOO', 'XOOOOOOO', 'XOOOOOO.'], 'black', 'black');
    h.until(humanTurn(h));
    h.tap('a3');
    h.until(() => h.callouts.some((c) => c.kind === 'pass'));
    let frames = 0;
    while (turnOf(h) !== 'human' && frames < 60) {
      h.frame();
      frames++;
    }
    expect(frames).toBeLessThanOrEqual(1);
    expect(h.announcements.some((a) => a.startsWith('CPUは打てる場所がないのでパスしました'))).toBe(true);
    // CPU のパスの後も、すぐに打てば早打ち（1 手目は対局の最初の手なので早打ちにならない）
    h.tap('h8');
    h.until(() => h.callouts.filter((c) => c.kind === 'score').length === 2);
    expect(h.callouts.flatMap((c) => (c.kind === 'score' ? [c.quick] : []))).toEqual([false, true]);
  });

  test('打てないマスを押しても打たない', async () => {
    const h = await setup();
    start(h);
    h.tap('a1');
    for (let i = 0; i < 30; i++) h.frame();
    expect(turnOf(h)).toBe('human');
    expect(h.announcements).toEqual([]);
  });

  test('音を解錠してから対局を用意する。始まりの演出の最初の音を、解錠の前に鳴らさない', async () => {
    const calls: string[] = [];
    class SpyAudio extends AudioEngine {
      override unlock(): void {
        calls.push('unlock');
      }
      override voice(): null {
        calls.push('voice');
        return null;
      }
    }
    const h = await setup({ audio: new SpyAudio(() => null) });
    calls.length = 0;
    h.session.start({ human: BLACK }, 0);
    expect(calls[0]).toBe('unlock');
    expect(calls).toContain('voice');
  });

  test('白を持つと CPU の黒から始まる', async () => {
    const h = await setup();
    h.session.start({ human: WHITE }, 0);
    h.until(humanTurn(h));
    expect(h.announcements[0]).toMatch(/^CPU: /);
  });

  test('一時停止中は世界が進まず、入力も受け付けない', async () => {
    const h = await setup();
    start(h);
    h.session.setPaused(true);
    expect(h.input.active).toBe(false);
    // 一時停止した直後の 1 回だけ描き直し、以後は世界が進まないので描かない
    h.frame();
    const g = h.graphics[h.graphics.length - 1];
    const renders = g?.renders ?? 0;
    h.tap('f5');
    for (let i = 0; i < 20; i++) h.frame();
    expect(h.announcements).toEqual([]);
    expect(g?.renders).toBe(renders);
    h.session.setPaused(false);
    expect(h.input.active).toBe(true);
  });

  test('自動操作で終局まで進み、儀式を経て結果を 1 回だけ知らせる', async () => {
    const h = await setup();
    start(h, { human: BLACK });
    h.hooks.setDebugAutoplay(true);
    h.until(() => h.events.some((e) => e.t === 'finished'), 60 * 60 * 10);
    expect(h.events.filter((e) => e.t === 'runEnding')).toHaveLength(1);
    const finished = h.events.filter((e) => e.t === 'finished');
    expect(finished).toHaveLength(1);
    const r = finished[0]?.t === 'finished' ? finished[0].result : null;
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.human + r.cpu).toBeLessThanOrEqual(64);
    // 得点の内訳: 対局中の得点（HUD に出していた値）に、終局の点を足す
    expect(r.score).toEqual(sheetOf({ moves: r.score.moves, quick: r.score.quick, fullCombo: r.fullCombo, discs: r.human, won: r.outcome === 'win', perfect: r.perfect, maxCombo: r.maxCombo }));
    expect(r.score.moves).toBeGreaterThan(0);
    expect(r.maxCombo).toBeGreaterThan(0);
    // 儀式で数えた数が、結果の石の数と一致し、HUD の得点は対局中の得点に石の点を足した値になる
    expect(h.hud?.black).toBe(r.human);
    expect(h.hud?.white).toBe(r.cpu);
    expect(h.hud?.score).toBe(r.score.moves + r.score.quick + r.score.discPoints);
    expect(h.announcements.at(-1)).toMatch(/^終局。あなた \d+、CPU \d+。(勝ち|負け|引き分け)です$/);
  });

  test('終局した後に押して離すと、儀式を飛ばしてすぐに結果を知らせる。終局より前から押していた指では飛ばさない', async () => {
    const h = await setup();
    start(h, { human: BLACK });
    h.hooks.setDebugAutoplay(true);
    h.until(() => h.events.some((e) => e.t === 'runEnding'), 60 * 60 * 10);
    h.hooks.setDebugAutoplay(false);
    const early = h.nowSeconds - 10;
    h.input.handlers.onRelease(10, 10, early);
    expect(h.events.some((e) => e.t === 'finished')).toBe(false);
    h.frame();
    h.input.handlers.onRelease(10, 10, h.nowSeconds);
    const finished = h.events.find((e) => e.t === 'finished');
    expect(finished).toBeDefined();
    const r = finished?.t === 'finished' ? finished.result : null;
    if (!r) return;
    // 飛ばしても、HUD は数えきった石の数と、対局中の得点に石の点を足した得点になる
    h.frame();
    expect([h.hud?.black, h.hud?.white]).toEqual([r.human, r.cpu]);
    expect(h.hud?.score).toBe(r.score.moves + r.score.quick + r.score.discPoints);
  });

  test('人の打つ手で文字を出すときは、描画領域の CSS ピクセルの位置で渡す', async () => {
    const h = await setup();
    // 黒が c4 に打つと 7 枚返る
    h.hooks.debugStart(['........', '........', '........', '...OOOX.', '..OO....', '..O.O...', '..X..X..', '........'], 'black', 'black');
    h.until(humanTurn(h));
    h.tap('c4');
    h.until(() => h.callouts.length > 0);
    const c = h.callouts[0];
    expect(c?.kind).toBe('flips');
    if (c?.kind !== 'flips') return;
    const layout = computeLayout(WIDTH, HEIGHT, HUD.top, HUD.bottom);
    expect(c.x).toBeCloseTo(toPxX(layout, cellX(parseSquare('c4'))), 6);
    expect(c.y).toBeCloseTo(toPxY(layout, cellY(parseSquare('c4'))), 6);
  });

  test('GPU を失っても、対局を続けたまま描画一式を作り直す。作り直せなければ lost を 1 回だけ知らせる', async () => {
    const h = await setup();
    start(h);
    h.loseGpu();
    h.frame();
    await h.settle();
    h.frame();
    expect(h.graphics).toHaveLength(2);
    expect(h.graphics[0]?.disposed).toBe(true);
    h.tap('f5');
    h.until(() => turnOf(h) === 'cpu');

    const f = await setup({ failRecovery: true });
    start(f);
    f.loseGpu();
    f.frame();
    await f.settle();
    f.frame();
    expect(f.events.filter((e) => e.t === 'fatal').map((e) => (e.t === 'fatal' ? e.cause : ''))).toEqual(['lost']);
  });

  test('確定石の点は、その手で確定石になった人の石だけを数える。CPU の手で確定した人の石は、次の人の手に数えない', async () => {
    const h = await setup();
    // 黒（人）が c5 に打つと、白（CPU）は h1 にしか打てず、1 行目が埋まって黒の b1〜f1 が確定石になる。黒は続けて e6 に打つ
    h.hooks.debugStart(['OXXXXXO.', '.......X', '.......O', '........', '...OX...', '........', '....O...', '....X...'], 'black', 'black');
    h.until(humanTurn(h));
    h.tap('c5');
    h.until(() => turnOf(h) === 'cpu');
    h.until(humanTurn(h));
    h.tap('e6');
    h.until(() => h.events.some((e) => e.t === 'runEnding'));
    const scores = h.callouts.flatMap((c) => (c.kind === 'score' ? [c.points] : []));
    // 1 手目は対局の最初の手なので早打ちにならず、2 手目はすぐに打ったので早打ち
    const move = (combo: number, quick: boolean) => scoreMove({ flipped: 1, corner: false, stableGained: 0, combo, quick }).total;
    expect(scores).toEqual([move(1, false), move(2, true)]);
  });

  test('人がパスしたら、コンボは途切れる。パスの後の手は新しいコンボの 1 手目で、フルコンボにもならない', async () => {
    const h = await setup();
    // 黒（人）が h8 に打つと、白（CPU）が b1 に打ち、黒はパスして、白が b7 に打つ
    h.hooks.debugStart(['O.XXXXOX', 'OOXXOOOX', 'OOXOOXOX', 'OOXOXXOX', 'OOOXOXOX', 'OOXOOOOO', 'O.XXOOOO', '.XXXXOO.'], 'black', 'black');
    h.until(humanTurn(h));
    h.tap('h8');
    h.until(() => h.callouts.some((c) => c.kind === 'pass' && c.who === 'human'));
    h.until(humanTurn(h));
    h.hooks.setDebugAutoplay(true);
    h.frame();
    h.hooks.setDebugAutoplay(false);
    h.until(() => h.callouts.filter((c) => c.kind === 'score').length === 2);
    // 1 手目は 1、パスで途切れ、パスの後の手も 1 なので、コンボの数は出ない。倍率も ×1 のまま
    expect(h.callouts.filter((c) => c.kind === 'combo')).toEqual([]);
    expect(h.callouts.flatMap((c) => (c.kind === 'score' ? [c.multiplier] : []))).toEqual([1, 1]);
    h.until(() => h.events.some((e) => e.t === 'finished'), 60 * 60);
    const finished = h.events.find((e) => e.t === 'finished');
    expect(finished?.t === 'finished' && finished.result.fullCombo).toBe(false);
  });

  test('キーボードでカーソルを出すと人が打てる最初のマスに置き、決めるとそこに打つ', async () => {
    const h = await setup();
    start(h);
    h.input.handlers.onKeyMove(1, 0);
    h.input.handlers.onKeyConfirm(h.nowSeconds);
    expect(h.announcements[0]).toBe('あなた: d3、1 枚返しました');
  });

  test('終局の儀式に入ると、コンボのゲージとフィーバーを止める', async () => {
    const h = await setup();
    start(h, { human: BLACK });
    h.hooks.setDebugAutoplay(true);
    h.until(() => h.events.some((e) => e.t === 'runEnding'), 60 * 60 * 10);
    expect(h.huds.some((s) => s.fever > 0)).toBe(true);
    h.frame();
    expect([h.hud?.fever, h.hud?.comboWindow]).toEqual([0, 0]);
  });

  test('対局を始めるたびに、その設定を画面へ知らせる。開発用の操作口から始めた対局も同じ', async () => {
    const h = await setup();
    h.session.start({ human: BLACK }, 0);
    h.hooks.debugStart(['........', '........', '........', '...OX...', '...XO...', '........', '........', '........'], 'black', 'white');
    expect(h.events.filter((e) => e.t === 'started')).toEqual([
      { t: 'started', setup: { human: BLACK } },
      { t: 'started', setup: { human: WHITE } },
    ]);
  });

  test('開発用の操作口に始められない局面を渡すと投げ、今の対局をそのまま続ける', async () => {
    const h = await setup();
    start(h);
    const rows = ['XXX.....', '........', '........', '........', '........', '........', '........', '.....OOO'];
    expect(() => h.hooks.debugStart(rows, 'white', 'black')).toThrow();
    expect(turnOf(h)).toBe('human');
    expect(h.input.active).toBe(true);
    h.tap('f5');
    expect(h.announcements[0]).toBe('あなた: f5、1 枚返しました');
  });

  test('開発用の操作口から始めた対局は、練習の結果として知らせる', async () => {
    const h = await setup();
    // 黒が a3 に打つと白がパスし、黒が h8 に打って終局する
    h.hooks.debugStart(['OOOOOXXO', 'XOOOXXXO', '.OXXOXXO', 'OOOOOXOO', 'OOOXOOXO', 'XXOXOOOO', 'XOOOOOOO', 'XOOOOOO.'], 'black', 'black');
    h.hooks.setDebugAutoplay(true);
    h.until(() => h.events.some((e) => e.t === 'finished'), 60 * 60);
    const finished = h.events.find((e) => e.t === 'finished');
    expect(finished?.t === 'finished' && finished.result.practice).toBe(true);
  });

  test('HUD の最高スコアの更新は、対局中の得点が超えたときだけ。終局の石の点で超えた分は、結果にだけ出す', async () => {
    const play = async (bestScore: number) => {
      const h = await setup();
      h.session.start({ human: BLACK }, bestScore);
      h.until(humanTurn(h));
      h.hooks.setDebugAutoplay(true);
      h.until(() => h.events.some((e) => e.t === 'finished'), 60 * 60 * 10);
      const finished = h.events.find((e) => e.t === 'finished');
      if (finished?.t !== 'finished') throw new Error('not finished');
      return { h, result: finished.result };
    };
    const first = await play(0);
    expect(first.result.newBest).toBe(false);
    // 同じ乱数の種と操作なら同じ対局になる。対局中の得点ちょうどを最高スコアにすると、対局中には超えない
    const inGame = first.result.score.moves + first.result.score.quick;
    const again = await play(inGame);
    expect(again.result.score).toEqual(first.result.score);
    expect(again.h.huds.some((s) => s.newBest)).toBe(false);
    expect(again.h.hud?.score).toBeGreaterThan(inGame);
    expect(again.result.newBest).toBe(true);
  });
});

describe('リバーシの GameSession: 音のエンジンの一時停止', () => {
  const pausedSetup = async () => {
    const audio = new PauseSpyAudio(() => null);
    const h = await setup({ audio });
    start(h);
    h.session.setPaused(true);
    expect(audio.enginePaused).toBe(true);
    return { h, audio };
  };

  test('一時停止するとエンジンも止め、解くとエンジンも動かす', async () => {
    const { h, audio } = await pausedSetup();
    h.session.setPaused(false);
    expect(audio.enginePaused).toBe(false);
  });

  test('一時停止したまま対局を終えると、エンジンの一時停止も解く', async () => {
    const { h, audio } = await pausedSetup();
    h.session.endRun();
    expect(audio.enginePaused).toBe(false);
  });

  test('一時停止したまま次の対局を始めると、エンジンの一時停止も解く', async () => {
    const { h, audio } = await pausedSetup();
    h.session.start({ human: WHITE }, 0);
    expect(audio.enginePaused).toBe(false);
  });

  test('一時停止したまま開発用の操作口から対局を始めると、エンジンの一時停止も解く', async () => {
    const { h, audio } = await pausedSetup();
    h.hooks.debugStart(['........', '........', '........', '...OX...', '...XO...', '........', '........', '........'], 'black', 'black');
    expect(audio.enginePaused).toBe(false);
  });

  test('一時停止したまま画面を離れると、エンジンの一時停止も解く', async () => {
    const { h, audio } = await pausedSetup();
    h.session.dispose();
    expect(audio.enginePaused).toBe(false);
  });

  test('一時停止したまま続けられなくなったら、エンジンの一時停止も解く', async () => {
    const audio = new PauseSpyAudio(() => null);
    const h = await setup({ audio, failRecovery: true });
    start(h);
    h.session.setPaused(true);
    expect(audio.enginePaused).toBe(true);
    h.loseGpu();
    h.frame();
    await h.settle();
    h.frame();
    expect(h.events.filter((e) => e.t === 'fatal').map((e) => (e.t === 'fatal' ? e.cause : ''))).toEqual(['lost']);
    expect(audio.enginePaused).toBe(false);
  });
});
