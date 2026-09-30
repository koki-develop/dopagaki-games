import { describe, expect, test } from 'bun:test';
import { ScoreTicker } from './score-ticker.ts';

describe('ScoreTicker', () => {
  test('対局中の得点が最高スコアを初めて超えた手で 1 回だけ更新になる。記録がなければならない', () => {
    const t = new ScoreTicker(100);
    expect([t.crosses(100), t.crosses(101), t.crosses(500)]).toEqual([false, true, false]);
    expect(new ScoreTicker(0).crosses(1_000_000)).toBe(false);
  });

  test('HUD の BEST は、更新の演出を出したときに付き、出す得点の増え方には左右されない', () => {
    const t = new ScoreTicker(100);
    t.add(500);
    expect(t.newBest).toBe(false);
    expect(t.crosses(101)).toBe(true);
    t.celebrate();
    expect([t.shown, t.newBest]).toEqual([500, true]);
  });
});
