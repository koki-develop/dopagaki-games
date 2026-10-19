import { describe, expect, test } from 'bun:test';
import { createControllerStore, RESULT_INPUT_GUARD_MS, transition } from './controller.ts';
import type { ControllerContext, ControllerEvent, Phase } from './controller.ts';
import { applyResult, emptyRecords } from './records-model.ts';
import type { Records, RecordsStore } from './records-model.ts';
import { runResult } from './result.test-support.ts';
import type { GamePort, RunResult } from './types.ts';

const RESULT: RunResult = runResult();

const ctx = (over: Partial<ControllerContext> = {}): ControllerContext => ({ now: 0, records: emptyRecords(), ...over });

/** イベントを順に送った後の状態と、出た命令 */
function run(events: ControllerEvent[], c: ControllerContext = ctx()) {
  let state: Phase = { k: 'loading' };
  const commands: string[] = [];
  for (const e of events) {
    const t = transition(state, e, c);
    state = t.state;
    for (const cmd of t.commands) commands.push(cmd.c === 'start' ? `start ${cmd.bestScore}` : cmd.c === 'setPaused' ? `pause ${cmd.paused}` : cmd.c);
  }
  return { state, commands };
}

const toPlaying: ControllerEvent[] = [{ t: 'loaded' }, { t: 'start' }];

describe('transition', () => {
  test('タイトルから、記録の最高スコアを渡して始める', () => {
    const records = applyResult(emptyRecords(), RESULT);
    const { state, commands } = run(toPlaying, ctx({ records }));
    expect(state).toEqual({ k: 'playing' });
    expect(commands).toEqual([`start ${RESULT.score.total}`]);
  });

  test('プレイ中の一時停止・タブの切り替え・Escape は一時停止にし、再開で戻す', () => {
    for (const t of ['pause', 'hidden', 'escape'] as const) {
      const { state, commands } = run([...toPlaying, { t }]);
      expect(state.k).toBe('paused');
      expect(commands.at(-1)).toBe('pause true');
    }
    const { state, commands } = run([...toPlaying, { t: 'pause' }, { t: 'resume' }]);
    expect(state.k).toBe('playing');
    expect(commands.at(-1)).toBe('pause false');
  });

  test('やり直しとタイトルへは確認を挟む', () => {
    const retry = run([...toPlaying, { t: 'pause' }, { t: 'askRetry' }, { t: 'confirm' }]);
    expect(retry.state.k).toBe('playing');
    expect(retry.commands.at(-1)).toBe('start 0');
    const cancel = run([...toPlaying, { t: 'pause' }, { t: 'askTitle' }, { t: 'escape' }]);
    expect(cancel.state).toEqual({ k: 'paused', sheet: null });
    const title = run([...toPlaying, { t: 'pause' }, { t: 'askTitle' }, { t: 'confirm' }]);
    expect(title.state).toEqual({ k: 'title', sheet: null });
    expect(title.commands.at(-1)).toBe('endRun');
  });

  test('終わりの儀式の間は一時停止できず、確定したら記録して結果画面へ進む', () => {
    const { state, commands } = run([...toPlaying, { t: 'runEnding' }, { t: 'pause' }, { t: 'finished', result: RESULT }], ctx({ now: 100 }));
    expect(state).toEqual({ k: 'result', result: RESULT, shownAt: 100 });
    expect(commands).toEqual(['start 0', 'commit']);
  });

  test('練習のプレイの結果は、結果画面に出すが記録しない', () => {
    const { state, commands } = run([...toPlaying, { t: 'runEnding' }, { t: 'finished', result: { ...RESULT, practice: true } }]);
    expect(state.k).toBe('result');
    expect(commands).toEqual(['start 0']);
  });

  test('結果画面の直後の操作は受け付けない', () => {
    let state: Phase = run([...toPlaying, { t: 'runEnding' }, { t: 'finished', result: RESULT }]).state;
    state = transition(state, { t: 'retry' }, ctx({ now: RESULT_INPUT_GUARD_MS - 1 })).state;
    expect(state.k).toBe('result');
    expect(transition(state, { t: 'retry' }, ctx({ now: RESULT_INPUT_GUARD_MS })).state.k).toBe('playing');
    expect(transition(state, { t: 'toTitle' }, ctx({ now: RESULT_INPUT_GUARD_MS })).commands).toEqual([{ c: 'endRun' }]);
  });

  test('タイトルでは設定だけを開ける', () => {
    const { state } = run([{ t: 'loaded' }, { t: 'openSettings' }, { t: 'start' }]);
    expect(state).toEqual({ k: 'title', sheet: 'settings' });
  });

  test('ゲームがプレイを始めたら、どの画面からでもプレイ中へ移る。命令は出さない', () => {
    const ending = [...toPlaying, { t: 'runEnding' } as const];
    for (const events of [[{ t: 'loaded' } as const], [...toPlaying, { t: 'pause' } as const], ending, [...ending, { t: 'finished', result: RESULT } as const]]) {
      const before = run(events).commands;
      const { state, commands } = run([...events, { t: 'started' }]);
      expect(state).toEqual({ k: 'playing' });
      expect(commands).toEqual(before);
    }
    const playing = run(toPlaying).state;
    expect(transition(playing, { t: 'started' }, ctx()).state).toBe(playing);
    expect(run([{ t: 'started' }]).state).toEqual({ k: 'loading' });
    expect(run([{ t: 'fatal', cause: 'init', message: 'x' }, { t: 'started' }]).state.k).toBe('error');
  });

  test('読み込み中の失敗は捨てる命令を出さず、それ以外はプレイを捨てる', () => {
    expect(run([{ t: 'fatal', cause: 'init', message: 'no gpu' }]).commands).toEqual([]);
    const r = run([...toPlaying, { t: 'fatal', cause: 'lost', message: 'gpu' }]);
    expect(r.state).toEqual({ k: 'error', cause: 'lost', message: 'gpu' });
    expect(r.commands.at(-1)).toBe('endRun');
  });
});

const fakePort = () => {
  const calls: string[] = [];
  const port: GamePort & { calls: string[] } = {
    calls,
    start: (best) => void calls.push(`start ${best}`),
    setPaused: (p) => void calls.push(`setPaused ${p}`),
    endRun: () => void calls.push('endRun'),
  };
  return port;
};

const memRecords = (): RecordsStore & { committed: RunResult[] } => {
  let value: Records = emptyRecords();
  const committed: RunResult[] = [];
  return {
    committed,
    get: () => value,
    subscribe: () => () => {},
    commit: (r) => {
      committed.push(r);
      value = applyResult(value, r);
    },
    dispose: () => {},
  };
};

describe('createControllerStore', () => {
  test('命令をゲームと記録へ実行する', () => {
    const port = fakePort();
    const records = memRecords();
    const store = createControllerStore(port, records, () => 0);
    store.dispatch({ t: 'loaded' });
    store.dispatch({ t: 'start' });
    store.dispatch({ t: 'runEnding' });
    store.dispatch({ t: 'finished', result: RESULT });
    expect(port.calls).toEqual(['start 0']);
    expect(records.committed).toHaveLength(1);
  });

  test('命令が失敗したら、ゲームの処理の失敗としてエラー画面へ移る', () => {
    const port = fakePort();
    port.start = () => {
      throw new Error('boom');
    };
    const store = createControllerStore(port, memRecords(), () => 0);
    store.dispatch({ t: 'loaded' });
    store.dispatch({ t: 'start' });
    expect(store.getSnapshot()).toEqual({ k: 'error', cause: 'internal', message: 'boom' });
  });
});
