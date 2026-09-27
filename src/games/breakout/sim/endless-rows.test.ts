import { describe, expect, test } from 'bun:test';
import { sanitizeTuning, tuning } from '../config.ts';
import { hardHpAt, hardRatioAt } from './endless-rows.ts';

const e = sanitizeTuning(tuning).endless;

describe('エンドレスの難易度', () => {
  test('ハードの HP は 2 から始まり、時間とともに上がって 12 で止まる', () => {
    expect(hardHpAt(e, 0)).toBe(2);
    expect(hardHpAt(e, 30)).toBe(Math.round(2 * 2 ** 1.7));
    let last = 0;
    for (let t = 0; t <= 3600; t += 5) {
      const hp = hardHpAt(e, t);
      expect(hp).toBeGreaterThanOrEqual(last);
      expect(hp).toBeLessThanOrEqual(12);
      last = hp;
    }
    expect(last).toBe(12);
    expect(hardHpAt(e, 1e9)).toBe(12);
  });

  test('ハードの出現率は 540 秒かけて 0.14 から 0.8 まで上がり、その後は変わらない', () => {
    expect(hardRatioAt(e, 0)).toBeCloseTo(0.14, 12);
    expect(hardRatioAt(e, 270)).toBeCloseTo(0.47, 12);
    expect(hardRatioAt(e, 540)).toBeCloseTo(0.8, 12);
    expect(hardRatioAt(e, 5400)).toBeCloseTo(0.8, 12);
  });
});
