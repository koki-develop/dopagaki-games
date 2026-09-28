import { describe, expect, test } from 'bun:test';
import { IntensityMeter } from './intensity.ts';
import { TierTracker } from './tiers.ts';

describe('TierTracker', () => {
  test('閾値で上がり、80% を下回ると下がる', () => {
    const t = new TierTracker();
    t.update(24);
    expect(t.tier).toBe(0);
    t.update(25);
    expect(t.tier).toBe(1);
    t.update(20);
    expect(t.tier).toBe(1);
    t.update(19);
    expect(t.tier).toBe(0);
  });

  test('一度に複数の閾値を越えたら、一番上の段階まで上がる', () => {
    const t = new TierTracker();
    t.update(260);
    expect(t.tier).toBe(3);
    t.update(500);
    expect(t.tier).toBe(4);
  });
});

describe('IntensityMeter', () => {
  test('破壊が続くと上がり、止まると下がる。0〜1 に収まる', () => {
    const m = new IntensityMeter();
    for (let i = 0; i < 120; i++) m.update(5, 100, 1 / 60);
    expect(m.rate).toBeGreaterThan(250);
    expect(m.intensity).toBeGreaterThan(0.8);
    expect(m.intensity).toBeLessThanOrEqual(1);
    for (let i = 0; i < 180; i++) m.update(0, 0, 1 / 60);
    expect(m.intensity).toBeLessThan(0.05);
  });

  test('フレームレートが違っても、同じ破壊ペースなら同じ値に収束する', () => {
    const a = new IntensityMeter();
    const b = new IntensityMeter();
    for (let i = 0; i < 240; i++) a.update(1, 0, 1 / 120);
    for (let i = 0; i < 60; i++) b.update(2, 0, 1 / 30);
    expect(a.rate).toBeCloseTo(120, 0);
    expect(b.rate).toBeGreaterThan(55);
    expect(b.rate).toBeLessThan(75);
  });
});
