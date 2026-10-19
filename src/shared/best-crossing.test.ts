import { describe, expect, test } from 'bun:test';
import { BestCrossing } from './best-crossing.ts';

describe('BestCrossing', () => {
  test('上回るかはいつでも最高スコアとの比較で、超えた瞬間は 1 回だけ', () => {
    const b = new BestCrossing(100);
    expect(b.exceeds(100)).toBe(false);
    expect(b.exceeds(101)).toBe(true);
    expect([b.cross(50), b.cross(100), b.cross(150), b.cross(200)]).toEqual([false, false, true, false]);
    expect(b.exceeds(200)).toBe(true);
  });

  test('記録がない（0）ときは、得点すれば上回るが、超えた瞬間にはならない', () => {
    const b = new BestCrossing(0);
    expect(b.exceeds(0)).toBe(false);
    expect(b.exceeds(1)).toBe(true);
    expect([b.cross(100000), b.cross(100000)]).toEqual([false, false]);
  });
});
