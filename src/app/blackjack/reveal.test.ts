import { describe, expect, test } from 'bun:test';
import { RESULT_REVEAL, resultTimeline } from './reveal.ts';

describe('resultTimeline', () => {
  test('合計は内訳を出しきってから数え、NEW BEST! は合計を数え終えてから出る', () => {
    const t = resultTimeline(4, true);
    expect(t.totalAt).toBe(RESULT_REVEAL.sheetAtMs + 4 * RESULT_REVEAL.lineStepMs);
    expect(t.newBestAt).toBeGreaterThan(t.totalAt + RESULT_REVEAL.totalCountMs);
  });

  test('累計は、合計を数え終え、更新したら NEW BEST! が弾け終えてから数える', () => {
    for (const lineCount of [2, 3, 4]) {
      const updated = resultTimeline(lineCount, true);
      expect(updated.lifetimeCountAt).toBeGreaterThan(updated.newBestAt + RESULT_REVEAL.popMs);
      const kept = resultTimeline(lineCount, false);
      expect(kept.lifetimeCountAt).toBeGreaterThan(kept.totalAt + RESULT_REVEAL.totalCountMs);
      expect(kept.lifetimeCountAt).toBeLessThan(updated.lifetimeCountAt);
    }
  });
});
