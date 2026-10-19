import { describe, expect, test } from 'bun:test';
import { CueQueue } from './cue-queue.ts';

describe('CueQueue', () => {
  test('時刻の来た予定を時刻の順に呼ぶ。同じ時刻は足した順', () => {
    const q = new CueQueue<null>();
    const log: string[] = [];
    q.add(0.3, () => void log.push('c'));
    q.add(0.1, () => void log.push('a'));
    q.add(0.3, () => void log.push('d'));
    q.add(0.2, () => void log.push('b'));
    q.runDue(0.25, null, 1);
    expect(log).toEqual(['a', 'b']);
    q.runDue(1, null, 1);
    expect(log).toEqual(['a', 'b', 'c', 'd']);
    expect(q.size).toBe(0);
  });

  test('呼んだ予定の中で足した予定も、時刻が来ていれば同じ呼び出しのうちに呼ぶ', () => {
    const q = new CueQueue<null>();
    const log: string[] = [];
    q.add(0.1, () => {
      log.push('a');
      q.add(0.05, () => void log.push('late'));
      q.add(0.5, () => void log.push('later'));
    });
    q.runDue(0.2, null, 1);
    expect(log).toEqual(['a', 'late']);
    expect(q.size).toBe(1);
    q.clear();
    q.runDue(1, null, 1);
    expect(log).toEqual(['a', 'late']);
  });
});
