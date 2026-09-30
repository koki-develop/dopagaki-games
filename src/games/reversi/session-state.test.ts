import { describe, expect, test } from 'bun:test';
import { boardInput, IDLE, inputActive, reduceSession, releaseSkips, worldAdvances } from './session-state.ts';
import type { SessionState } from './session-state.ts';

const started = (): SessionState => reduceSession(IDLE, { t: 'start' });

describe('reduceSession', () => {
  test('始めると対局中になり、盤への入力を受け付け、世界が進む', () => {
    const s = started();
    expect(s).toEqual({ k: 'run', stage: 'playing', paused: false, endingAt: Number.NaN });
    expect([inputActive(s), boardInput(s), worldAdvances(s)]).toEqual([true, true, true]);
  });

  test('一時停止中は入力も世界も止まる。再開で戻る', () => {
    const paused = reduceSession(started(), { t: 'setPaused', paused: true });
    expect([inputActive(paused), worldAdvances(paused)]).toEqual([false, false]);
    expect(reduceSession(paused, { t: 'setPaused', paused: true })).toBe(paused);
    const resumed = reduceSession(paused, { t: 'setPaused', paused: false });
    expect(worldAdvances(resumed)).toBe(true);
  });

  test('終局の儀式は止められず、盤のマスは選べないが、飛ばすタップは受け付ける', () => {
    const ending = reduceSession(started(), { t: 'ending', at: 5 });
    expect(reduceSession(ending, { t: 'setPaused', paused: true })).toBe(ending);
    expect([inputActive(ending), boardInput(ending)]).toEqual([true, false]);
    expect(releaseSkips(ending, 5.1)).toBe(true);
    expect(releaseSkips(ending, 4.9)).toBe(false);
  });

  test('結果が確定すると入力を受け付けないが、世界は動き続ける', () => {
    const after = reduceSession(reduceSession(started(), { t: 'ending', at: 5 }), { t: 'finished' });
    expect([inputActive(after), worldAdvances(after)]).toEqual([false, true]);
    expect(releaseSkips(after, 6)).toBe(false);
  });

  test('対局を捨てると何もない盤へ戻る', () => {
    expect(reduceSession(started(), { t: 'endRun' })).toBe(IDLE);
    expect(reduceSession(IDLE, { t: 'endRun' })).toBe(IDLE);
    expect(reduceSession(IDLE, { t: 'finished' })).toBe(IDLE);
  });
});
