import { describe, expect, test } from 'bun:test';
import { IDLE, inputActive, reduceSession, releaseLaunches, releaseSkips, worldAdvances } from './session-state.ts';
import type { SessionAction, SessionState } from './session-state.ts';

const run = (...actions: SessionAction[]): SessionState => actions.reduce(reduceSession, IDLE);

describe('SessionState', () => {
  test('用意したプレイは止まっておらず、入力はまだ受け付けないが、世界は進む', () => {
    const s = run({ t: 'prepare', id: 1 });
    expect(s).toMatchObject({ k: 'run', id: 1, stage: 'ready', paused: false });
    expect(inputActive(s)).toBe(false);
    expect(worldAdvances(s)).toBe(true);
    expect(releaseLaunches(s)).toBe(false);
  });

  test('begin でプレイが始まり、入力を受け付ける', () => {
    const s = run({ t: 'prepare', id: 1 }, { t: 'begin' });
    expect(s).toMatchObject({ stage: 'playing', paused: false });
    expect(inputActive(s)).toBe(true);
    expect(releaseLaunches(s)).toBe(true);
  });

  test('一時停止中は入力も世界も止まり、再開で戻る', () => {
    const paused = run({ t: 'prepare', id: 1 }, { t: 'begin' }, { t: 'setPaused', paused: true });
    expect(inputActive(paused)).toBe(false);
    expect(worldAdvances(paused)).toBe(false);
    const resumed = reduceSession(paused, { t: 'setPaused', paused: false });
    expect(inputActive(resumed)).toBe(true);
    expect(worldAdvances(resumed)).toBe(true);
  });

  test('一時停止からやり直すと、新しいプレイは止まっておらず、begin で入力を受け付ける', () => {
    const s = run({ t: 'prepare', id: 1 }, { t: 'begin' }, { t: 'setPaused', paused: true }, { t: 'prepare', id: 2 }, { t: 'begin' });
    expect(s).toMatchObject({ id: 2, stage: 'playing', paused: false });
    expect(inputActive(s)).toBe(true);
  });

  test('止められるのはプレイ中だけ。用意中と、勝敗が決まった後の演出は止めない', () => {
    const ready = run({ t: 'prepare', id: 1 });
    expect(reduceSession(ready, { t: 'setPaused', paused: true })).toBe(ready);
    const ending = run({ t: 'prepare', id: 1 }, { t: 'begin' }, { t: 'ending', at: 5 });
    expect(reduceSession(ending, { t: 'setPaused', paused: true })).toBe(ending);
    const after = run({ t: 'prepare', id: 1 }, { t: 'begin' }, { t: 'ending', at: 5 }, { t: 'finished' });
    expect(reduceSession(after, { t: 'setPaused', paused: true })).toBe(after);
  });

  test('勝敗が決まったら、その後に押した入力だけが演出を飛ばす合図になる', () => {
    const s = run({ t: 'prepare', id: 1 }, { t: 'begin' }, { t: 'ending', at: 10 });
    expect(s).toMatchObject({ stage: 'ending', endingAt: 10 });
    expect(inputActive(s)).toBe(true);
    expect(releaseLaunches(s)).toBe(false);
    expect(releaseSkips(s, 9.99)).toBe(false);
    expect(releaseSkips(s, 10)).toBe(false);
    expect(releaseSkips(s, 10.01)).toBe(true);
  });

  test('結果が確定したら入力を受け付けず、結果画面の後ろで世界は進み続ける', () => {
    const after = run({ t: 'prepare', id: 1 }, { t: 'begin' }, { t: 'ending', at: 1 }, { t: 'finished' });
    expect(after).toMatchObject({ stage: 'afterglow' });
    expect(inputActive(after)).toBe(false);
    expect(releaseSkips(after, 2)).toBe(false);
    expect(worldAdvances(after)).toBe(true);
  });

  test('節目は順番どおりに 1 回だけ進む', () => {
    const playing = run({ t: 'prepare', id: 1 }, { t: 'begin' });
    expect(reduceSession(playing, { t: 'finished' })).toBe(playing);
    const ending = reduceSession(playing, { t: 'ending', at: 3 });
    expect(reduceSession(ending, { t: 'ending', at: 4 })).toBe(ending);
    const after = reduceSession(ending, { t: 'finished' });
    expect(reduceSession(after, { t: 'finished' })).toBe(after);
    expect(reduceSession(after, { t: 'begin' })).toBe(after);
  });

  test('プレイを捨てると idle に戻り、以後の節目は何も変えない', () => {
    const s = run({ t: 'prepare', id: 1 }, { t: 'begin' }, { t: 'endRun' });
    expect(s).toBe(IDLE);
    for (const a of [{ t: 'begin' }, { t: 'ending', at: 1 }, { t: 'finished' }, { t: 'setPaused', paused: true }] as SessionAction[]) {
      expect(reduceSession(s, a)).toBe(IDLE);
    }
    expect(inputActive(IDLE)).toBe(false);
    expect(worldAdvances(IDLE)).toBe(false);
    expect(reduceSession(IDLE, { t: 'endRun' })).toBe(IDLE);
  });

  test('どの状態でも、入力を受け付けるのは世界が進んでいて止まっていないときだけ', () => {
    const actions: SessionAction[] = [
      { t: 'prepare', id: 1 },
      { t: 'begin' },
      { t: 'setPaused', paused: true },
      { t: 'setPaused', paused: false },
      { t: 'ending', at: 1 },
      { t: 'finished' },
      { t: 'endRun' },
    ];
    // 長さ 4 までのすべての命令列
    const visit = (s: SessionState, depth: number) => {
      if (inputActive(s)) {
        expect(worldAdvances(s)).toBe(true);
        expect(s.k === 'run' && s.paused).toBe(false);
      }
      if (depth === 0) return;
      for (const a of actions) visit(reduceSession(s, a), depth - 1);
    };
    visit(IDLE, 4);
  });
});
