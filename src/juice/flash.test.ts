import { describe, expect, test } from 'bun:test';
import { FlashLimiter } from './flash.ts';

describe('FlashLimiter', () => {
  test('どの 1 秒の区間にも 3 回を超えて許可しない', () => {
    const f = new FlashLimiter(3, 1);
    const granted: number[] = [];
    for (let t = 0; t <= 5; t += 0.05) {
      const now = Math.round(t * 100) / 100;
      if (f.request(now)) granted.push(now);
    }
    for (let i = 0; i + 3 < granted.length; i++) {
      expect(granted[i + 3] - granted[i]).toBeGreaterThan(1);
    }
    expect(granted.length).toBeGreaterThanOrEqual(12);
  });

  test('窓の境界ちょうどの記録も数える', () => {
    const f = new FlashLimiter(3, 1);
    expect(f.request(0)).toBe(true);
    expect(f.request(0.5)).toBe(true);
    expect(f.request(0.9)).toBe(true);
    expect(f.request(1.0)).toBe(false);
    expect(f.request(1.01)).toBe(true);
  });

  test('窓から外れた記録は数えない', () => {
    const f = new FlashLimiter(3, 1);
    f.request(0);
    f.request(0.2);
    f.request(0.5);
    expect(f.request(1.1)).toBe(true);
    expect(f.request(1.15)).toBe(false);
    expect(f.request(1.21)).toBe(true);
  });
});
