import { describe, expect, test } from 'bun:test';
import { EventRate } from './rate.ts';

describe('EventRate', () => {
  test('一定のペースで起き続けると、フレームレートによらずそのペースに収束する', () => {
    for (const hz of [30, 60, 120, 144]) {
      const r = new EventRate(0.5);
      // 1 秒に 90 回。フレームあたりの回数は小数でもよい
      for (let i = 0; i < hz * 10; i++) r.update(90 / hz, 1 / hz);
      expect(r.rate).toBeCloseTo(90, 6);
    }
  });

  test('止まると tau で減っていく', () => {
    const r = new EventRate(0.5);
    for (let i = 0; i < 600; i++) r.update(1, 1 / 60);
    const before = r.rate;
    for (let i = 0; i < 30; i++) r.update(0, 1 / 60);
    expect(r.rate / before).toBeCloseTo(Math.exp(-0.5 / 0.5), 6);
  });

  test('dt が 0 のフレームの回数も数え、dt → 0 の極限の値を返す', () => {
    const r = new EventRate(0.5);
    expect(r.update(3, 0)).toBeCloseTo(6, 9);
    const tiny = new EventRate(0.5);
    expect(tiny.update(3, 1e-9)).toBeCloseTo(6, 6);
    // 溜めた分は次のフレームにも残る
    const keep = Math.exp(-1 / 30);
    expect(r.update(0, 1 / 60)).toBeCloseTo(3 * keep * (1 - keep) * 60, 9);
  });
});
