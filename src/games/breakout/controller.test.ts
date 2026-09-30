import { describe, expect, test } from 'bun:test';
import { createControllerStore, hasNextStage, RESULT_INPUT_GUARD_MS, transition } from './controller.ts';
import type { Command, ControllerContext, ControllerEvent, Phase } from './controller.ts';
import { createRecordsStore } from './records.ts';
import type { GamePort, RunMode, RunResult } from './types.ts';

const ENDLESS: RunMode = { kind: 'endless' };
const S0: RunMode = { kind: 'stage', index: 0 };
const S1: RunMode = { kind: 'stage', index: 1 };
const S4: RunMode = { kind: 'stage', index: 4 };

const res = (mode: RunMode, cleared: boolean, score = 100): RunResult => ({ mode, cleared, score, previousBest: 0, newBest: false });

const ctx = (over: Partial<ControllerContext> = {}): ControllerContext => ({
  now: 10_000,
  stageCount: 5,
  selectableStages: 2,
  best: (m) => (m.kind === 'endless' ? 700 : 30 + m.index),
  ...over,
});

const SHOWN = 10_000 - RESULT_INPUT_GUARD_MS;

/** 各 Phase の代表 */
const PHASES: Record<string, Phase> = {
  loading: { k: 'loading' },
  error: { k: 'error', cause: 'init', message: 'x' },
  title: { k: 'title', sheet: null },
  titleSettings: { k: 'title', sheet: 'settings' },
  stages: { k: 'stages' },
  ready: { k: 'ready', mode: S0 },
  playing: { k: 'playing', mode: S0 },
  paused: { k: 'paused', mode: S0, sheet: null },
  pausedSettings: { k: 'paused', mode: S0, sheet: 'settings' },
  pausedRetry: { k: 'paused', mode: S0, sheet: 'confirmRetry' },
  pausedTitle: { k: 'paused', mode: S0, sheet: 'confirmTitle' },
  ending: { k: 'ending', mode: S0 },
  result: { k: 'result', mode: S0, result: res(S0, true), shownAt: SHOWN },
  resultLast: { k: 'result', mode: S4, result: res(S4, true), shownAt: SHOWN },
  resultLost: { k: 'result', mode: S0, result: res(S0, false), shownAt: SHOWN },
  resultEndless: { k: 'result', mode: ENDLESS, result: res(ENDLESS, false), shownAt: SHOWN },
};

const FIN = res(S0, true, 1234);

/** 各イベントの代表 */
const EVENTS: Record<string, ControllerEvent> = {
  loaded: { t: 'loaded' },
  fatal: { t: 'fatal', cause: 'lost', message: 'gpu lost' },
  openStages: { t: 'openStages' },
  back: { t: 'back' },
  chooseEndless: { t: 'choose', mode: ENDLESS },
  chooseS1: { t: 'choose', mode: S1 },
  chooseLocked: { t: 'choose', mode: { kind: 'stage', index: 2 } },
  chooseBad: { t: 'choose', mode: { kind: 'stage', index: -1 } },
  start: { t: 'start' },
  pause: { t: 'pause' },
  hidden: { t: 'hidden' },
  resume: { t: 'resume' },
  askRetry: { t: 'askRetry' },
  askTitle: { t: 'askTitle' },
  confirm: { t: 'confirm' },
  cancel: { t: 'cancel' },
  openSettings: { t: 'openSettings' },
  closeSettings: { t: 'closeSettings' },
  runEnding: { t: 'runEnding' },
  finished: { t: 'finished', result: FIN },
  retry: { t: 'retry' },
  next: { t: 'next' },
  toTitle: { t: 'toTitle' },
  escape: { t: 'escape' },
};

type Expect = { state: Phase; commands?: Command[] };

const title: Phase = { k: 'title', sheet: null };
const playingS0: Phase = { k: 'playing', mode: S0 };
const pausedS0: Phase = { k: 'paused', mode: S0, sheet: null };
const toResult: Expect = { state: { k: 'result', mode: S0, result: FIN, shownAt: 10_000 }, commands: [{ c: 'commit', result: FIN }] };
const restartS0: Expect = { state: playingS0, commands: [{ c: 'prepare', mode: S0, previousBest: 30 }, { c: 'begin' }] };
const endRunToTitle: Expect = { state: title, commands: [{ c: 'endRun' }] };
const fatal = (from: string): Expect => ({ state: { k: 'error', cause: 'lost', message: 'gpu lost' }, commands: from === 'loading' ? [] : [{ c: 'endRun' }] });

/** 状態が変わる組み合わせ。ここにない組み合わせは、状態も命令も変わらない */
const TABLE: Record<string, Record<string, Expect>> = {
  loading: { loaded: { state: title }, fatal: fatal('loading') },
  error: {},
  title: {
    fatal: fatal('title'),
    openStages: { state: { k: 'stages' } },
    chooseEndless: { state: { k: 'ready', mode: ENDLESS }, commands: [{ c: 'prepare', mode: ENDLESS, previousBest: 700 }] },
    openSettings: { state: { k: 'title', sheet: 'settings' } },
  },
  titleSettings: { fatal: fatal('title'), closeSettings: { state: title }, escape: { state: title } },
  stages: {
    fatal: fatal('stages'),
    back: { state: title },
    escape: { state: title },
    chooseS1: { state: { k: 'ready', mode: S1 }, commands: [{ c: 'prepare', mode: S1, previousBest: 31 }] },
  },
  ready: { fatal: fatal('ready'), start: { state: playingS0, commands: [{ c: 'begin' }] } },
  playing: {
    fatal: fatal('playing'),
    pause: { state: pausedS0, commands: [{ c: 'setPaused', paused: true }] },
    hidden: { state: pausedS0, commands: [{ c: 'setPaused', paused: true }] },
    escape: { state: pausedS0, commands: [{ c: 'setPaused', paused: true }] },
    runEnding: { state: { k: 'ending', mode: S0 } },
    finished: toResult,
  },
  paused: {
    fatal: fatal('paused'),
    resume: { state: playingS0, commands: [{ c: 'setPaused', paused: false }] },
    escape: { state: playingS0, commands: [{ c: 'setPaused', paused: false }] },
    askRetry: { state: { ...pausedS0, sheet: 'confirmRetry' } },
    askTitle: { state: { ...pausedS0, sheet: 'confirmTitle' } },
    openSettings: { state: { ...pausedS0, sheet: 'settings' } },
  },
  pausedSettings: {
    fatal: fatal('paused'),
    closeSettings: { state: pausedS0 },
    escape: { state: pausedS0 },
  },
  pausedRetry: {
    fatal: fatal('paused'),
    cancel: { state: pausedS0 },
    escape: { state: pausedS0 },
    confirm: restartS0,
  },
  pausedTitle: {
    fatal: fatal('paused'),
    cancel: { state: pausedS0 },
    escape: { state: pausedS0 },
    confirm: endRunToTitle,
  },
  ending: { fatal: fatal('ending'), finished: toResult },
  result: {
    fatal: fatal('result'),
    retry: restartS0,
    next: { state: { k: 'playing', mode: S1 }, commands: [{ c: 'prepare', mode: S1, previousBest: 31 }, { c: 'begin' }] },
    toTitle: endRunToTitle,
  },
  resultLast: {
    fatal: fatal('result'),
    retry: { state: { k: 'playing', mode: S4 }, commands: [{ c: 'prepare', mode: S4, previousBest: 34 }, { c: 'begin' }] },
    toTitle: endRunToTitle,
  },
  resultLost: { fatal: fatal('result'), retry: restartS0, toTitle: endRunToTitle },
  resultEndless: {
    fatal: fatal('result'),
    retry: { state: { k: 'playing', mode: ENDLESS }, commands: [{ c: 'prepare', mode: ENDLESS, previousBest: 700 }, { c: 'begin' }] },
    toTitle: endRunToTitle,
  },
};

describe('transition: 全組み合わせ', () => {
  for (const [pName, phase] of Object.entries(PHASES)) {
    for (const [eName, event] of Object.entries(EVENTS)) {
      const expected = TABLE[pName]?.[eName];
      test(`${pName} × ${eName}`, () => {
        const out = transition(phase, event, ctx());
        if (!expected) {
          expect(out.state).toBe(phase);
          expect(out.commands).toEqual([]);
        } else {
          expect(out.state).toEqual(expected.state);
          expect(out.commands).toEqual(expected.commands ?? []);
        }
      });
    }
  }

  test('表に載っている組み合わせは、すべて実在する', () => {
    for (const [p, row] of Object.entries(TABLE)) {
      expect(PHASES[p]).toBeDefined();
      for (const e of Object.keys(row)) expect(EVENTS[e]).toBeDefined();
    }
  });
});

describe('transition: 不変条件', () => {
  test('結果画面を出した直後の操作は受け付けない', () => {
    const shown: Phase = { k: 'result', mode: S0, result: res(S0, true), shownAt: 10_000 };
    for (const t of ['retry', 'next', 'toTitle'] as const) {
      expect(transition(shown, { t }, ctx({ now: 10_000 + RESULT_INPUT_GUARD_MS - 1 })).state).toBe(shown);
      expect(transition(shown, { t }, ctx({ now: 10_000 + RESULT_INPUT_GUARD_MS })).state).not.toBe(shown);
    }
  });

  test('結果画面の時刻は finished を受けた時刻', () => {
    const out = transition({ k: 'ending', mode: S0 }, { t: 'finished', result: FIN }, ctx({ now: 42 }));
    expect(out.state).toMatchObject({ k: 'result', shownAt: 42 });
  });

  test('設定はタイトルと一時停止でだけ開ける', () => {
    for (const [name, p] of Object.entries(PHASES)) {
      const out = transition(p, { t: 'openSettings' }, ctx());
      const opened = out.state !== p && 'sheet' in out.state && out.state.sheet === 'settings';
      expect([name, opened]).toEqual([name, name === 'title' || name === 'paused']);
    }
  });

  test('記録の反映（commit）は finished でだけ出る', () => {
    for (const [pName, p] of Object.entries(PHASES)) {
      for (const [eName, e] of Object.entries(EVENTS)) {
        const commits = transition(p, e, ctx()).commands.filter((c) => c.c === 'commit').length;
        expect([pName, eName, commits]).toEqual([pName, eName, eName === 'finished' && TABLE[pName]?.finished ? 1 : 0]);
      }
    }
  });

  test('エラー画面は、届いた原因と文言をそのまま持つ', () => {
    for (const cause of ['init', 'lost', 'internal'] as const) {
      for (const [name, p] of Object.entries(PHASES)) {
        if (p.k === 'error') continue;
        const out = transition(p, { t: 'fatal', cause, message: 'm' }, ctx());
        expect([name, out.state]).toEqual([name, { k: 'error', cause, message: 'm' }]);
      }
    }
  });

  test('エラー画面では、次の fatal が来ても最初の原因のまま', () => {
    const err: Phase = { k: 'error', cause: 'init', message: 'first' };
    expect(transition(err, { t: 'fatal', cause: 'internal', message: 'second' }, ctx()).state).toBe(err);
  });

  test('一時停止中のゲームからは勝敗が届かないので、一時停止のまま変わらない', () => {
    for (const sheet of [null, 'settings', 'confirmRetry', 'confirmTitle'] as const) {
      const p: Phase = { k: 'paused', mode: S0, sheet };
      for (const e of [EVENTS.runEnding, EVENTS.finished]) {
        const out = transition(p, e, ctx());
        expect(out.state).toBe(p);
        expect(out.commands).toEqual([]);
      }
    }
  });

  test('範囲外のステージは選べない', () => {
    const stages: Phase = { k: 'stages' };
    expect(transition(stages, { t: 'choose', mode: { kind: 'stage', index: 1.5 } }, ctx()).state).toBe(stages);
    expect(transition(stages, { t: 'choose', mode: { kind: 'stage', index: 5 } }, ctx({ selectableStages: 9 })).state).toBe(stages);
  });

  test('次のステージがあるのは、最後以外のステージをクリアしたときだけ', () => {
    expect(hasNextStage(res(S0, true), 5)).toBe(true);
    expect(hasNextStage(res(S0, false), 5)).toBe(false);
    expect(hasNextStage(res(S4, true), 5)).toBe(false);
    expect(hasNextStage(res(ENDLESS, false), 5)).toBe(false);
  });
});

/** 呼ばれた命令を記録する GamePort */
const fakePort = () => {
  const calls: string[] = [];
  const port: GamePort & { calls: string[]; onPrepare?: () => void } = {
    calls,
    prepare: (m, best) => {
      calls.push(`prepare ${m.kind === 'endless' ? 'endless' : m.index} ${best}`);
      port.onPrepare?.();
    },
    begin: () => void calls.push('begin'),
    setPaused: (p) => void calls.push(`setPaused ${p}`),
    endRun: () => void calls.push('endRun'),
  };
  return port;
};

const memRecords = () => {
  const mem = new Map<string, string>();
  return createRecordsStore({
    storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) },
    stageIds: ['a', 'b', 'c', 'd', 'e'],
  });
};

describe('createControllerStore', () => {
  test('命令を GamePort へ実行し、結果はちょうど 1 回だけ記録する', () => {
    const port = fakePort();
    const records = memRecords();
    let commits = 0;
    const commit = records.commit;
    records.commit = (r) => {
      commits++;
      commit(r);
    };
    let t = 0;
    const store = createControllerStore(port, records, () => t);
    let notified = 0;
    store.subscribe(() => notified++);

    store.dispatch({ t: 'loaded' });
    store.dispatch({ t: 'choose', mode: ENDLESS });
    store.dispatch({ t: 'start' });
    store.dispatch({ t: 'runEnding' });
    store.dispatch({ t: 'finished', result: res(ENDLESS, false, 500) });
    store.dispatch({ t: 'finished', result: res(ENDLESS, false, 900) });
    expect(commits).toBe(1);
    expect(records.get().bestEndless).toBe(500);
    expect(store.getSnapshot().k).toBe('result');
    expect(notified).toBe(5);

    // やり直しは、いま記録されているベストで始める
    store.dispatch({ t: 'retry' });
    expect(store.getSnapshot().k).toBe('result');
    t = RESULT_INPUT_GUARD_MS;
    store.dispatch({ t: 'retry' });
    expect(port.calls).toEqual(['prepare endless 0', 'begin', 'prepare endless 500', 'begin']);
  });

  test('状態が変わらないイベントでは通知しない', () => {
    const store = createControllerStore(fakePort(), memRecords(), () => 0);
    let notified = 0;
    store.subscribe(() => notified++);
    store.dispatch({ t: 'pause' });
    store.dispatch({ t: 'retry' });
    expect(notified).toBe(0);
  });

  test('命令の実行中に届いたイベントは、その後で処理する', () => {
    const port = fakePort();
    const store = createControllerStore(port, memRecords(), () => 0);
    port.onPrepare = () => store.dispatch({ t: 'start' });
    store.dispatch({ t: 'loaded' });
    store.dispatch({ t: 'choose', mode: ENDLESS });
    expect(store.getSnapshot()).toEqual({ k: 'playing', mode: ENDLESS });
    expect(port.calls).toEqual(['prepare endless 0', 'begin']);
  });

  test('命令が失敗したら、ゲームの処理の失敗としてエラー画面へ移り、プレイを捨てる', () => {
    const port = fakePort();
    port.begin = () => {
      throw new Error('boom');
    };
    const store = createControllerStore(port, memRecords(), () => 0);
    store.dispatch({ t: 'loaded' });
    store.dispatch({ t: 'choose', mode: ENDLESS });
    store.dispatch({ t: 'start' });
    expect(store.getSnapshot()).toEqual({ k: 'error', cause: 'internal', message: 'boom' });
    expect(port.calls.at(-1)).toBe('endRun');
  });

  test('例外でない値を投げた命令も、文字列にしてエラー画面に出す', () => {
    const port = fakePort();
    port.prepare = () => {
      throw 'plain';
    };
    const store = createControllerStore(port, memRecords(), () => 0);
    store.dispatch({ t: 'loaded' });
    store.dispatch({ t: 'choose', mode: ENDLESS });
    expect(store.getSnapshot()).toEqual({ k: 'error', cause: 'internal', message: 'plain' });
  });

  test('読み込み中の失敗は、プレイを捨てる命令を出さずにエラー画面へ移る', () => {
    const port = fakePort();
    const store = createControllerStore(port, memRecords(), () => 0);
    store.dispatch({ t: 'fatal', cause: 'init', message: 'no gpu' });
    expect(store.getSnapshot()).toEqual({ k: 'error', cause: 'init', message: 'no gpu' });
    expect(port.calls).toEqual([]);
  });

  test('勝敗が決まった後の演出中（ending）を経て、結果画面へ進む', () => {
    const store = createControllerStore(fakePort(), memRecords(), () => 0);
    for (const e of [EVENTS.loaded, EVENTS.chooseEndless, EVENTS.start, EVENTS.runEnding]) store.dispatch(e);
    expect(store.getSnapshot()).toEqual({ k: 'ending', mode: ENDLESS });
    store.dispatch({ t: 'pause' });
    expect(store.getSnapshot().k).toBe('ending');
    store.dispatch({ t: 'finished', result: res(ENDLESS, false, 5) });
    expect(store.getSnapshot().k).toBe('result');
  });
});
