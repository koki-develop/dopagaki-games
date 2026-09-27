import { describe, expect, test } from 'bun:test';
import { TUNING_LIMITS, sanitizeTuning, snapshotTuning, tuning } from './config.ts';
import type { Tuning } from './config.ts';

const clone = () => structuredClone(tuning) as Tuning;

describe('調整値の検証', () => {
  test('初期値はどれも許容範囲の中にあり、そのまま通る', () => {
    expect(sanitizeTuning(tuning)).toEqual(tuning);
    for (const [section, ranges] of Object.entries(TUNING_LIMITS)) {
      for (const [key, range] of Object.entries(ranges)) {
        const v = (tuning as unknown as Record<string, Record<string, number>>)[section][key];
        expect(v).toBeGreaterThanOrEqual(range.min);
        expect(v).toBeLessThanOrEqual(range.max);
        if (range.int) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  test('範囲外の値は範囲に収め、整数の値は丸める', () => {
    const t = clone();
    t.endless.hardHpMax = 1000;
    t.endless.hardHpStart = 300;
    t.endless.initialRows = 100;
    t.endless.refillRows = 70;
    t.endless.penaltyRows = -5;
    t.ball.speedStart = 0;
    t.blocks.ballsFromMega = 6.6;
    t.score.chainDivisor = 0;
    const c = sanitizeTuning(t);
    expect(c.endless.hardHpMax).toBe(255);
    expect(c.endless.hardHpStart).toBe(255);
    expect(c.endless.initialRows).toBe(TUNING_LIMITS.endless.initialRows.max);
    expect(c.endless.refillRows).toBe(TUNING_LIMITS.endless.refillRows.max);
    expect(c.endless.penaltyRows).toBe(0);
    expect(c.ball.speedStart).toBeGreaterThan(0);
    expect(c.blocks.ballsFromMega).toBe(7);
    expect(c.score.chainDivisor).toBeGreaterThan(0);
  });

  test('数でない値は初期値に戻す', () => {
    const t = clone();
    t.ball.speedMax = Number.NaN;
    t.paddle.width = Infinity;
    (t.score as Record<string, unknown>).pointsBall = 'x';
    const c = sanitizeTuning(t);
    expect(c.ball.speedMax).toBe(tuning.ball.speedMax);
    expect(c.paddle.width).toBe(tuning.paddle.width);
    expect(c.score.pointsBall).toBe(tuning.score.pointsBall);
  });

  test('最小と最大の組は、最大が最小を下回らないようにそろえる', () => {
    const t = clone();
    t.endless.bandRowsMin = 6;
    t.endless.bandRowsMax = 2;
    t.endless.gapRowsMin = 3;
    t.endless.gapRowsMax = 1;
    const c = sanitizeTuning(t);
    expect(c.endless.bandRowsMax).toBe(6);
    expect(c.endless.gapRowsMax).toBe(3);
  });

  test('写しは凍結されていて、元の調整値を後から書き換えても変わらない', () => {
    const snap = snapshotTuning();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.paddle)).toBe(true);
    const before = tuning.paddle.width;
    try {
      tuning.paddle.width = 3;
      expect(snap.paddle.width).toBe(before);
      expect(snapshotTuning().paddle.width).toBe(3);
    } finally {
      tuning.paddle.width = before;
    }
  });
});
