import { describe, expect, test } from 'bun:test';
import { BlockType, FIELD_H } from '../config.ts';
import { blockHue, HARD_RGB, neonRgb, SOLID_RGB } from '../view/palette.ts';
import { ParticleFx } from './particle-fx.ts';
import { ParticleShape } from './particle-shape.ts';
import type { DebrisSpec, ParticleSpec } from './particle-shape.ts';
import { CountingSink } from './test-kit.test-support.ts';

function make() {
  const particles = new CountingSink<ParticleSpec>();
  const debris = new CountingSink<DebrisSpec>();
  particles.keep = true;
  debris.keep = true;
  return { particles, debris, fx: new ParticleFx(particles, debris) };
}

describe('ParticleFx', () => {
  test('ブロックの破壊: 光の点 1 つ + 火花 5 個 + 破片 2 個（ハードは 3 個）。色は行の高さだけで決まる', () => {
    const { particles, debris, fx } = make();
    fx.blockBreak(7, 3, 8, BlockType.Ball, 1, true);
    expect(particles.count).toBe(6);
    expect(debris.count).toBe(2);
    const c = neonRgb(blockHue(8 / FIELD_H), [0, 0, 0]);
    const dot = particles.kept[0];
    expect(dot.shape).toBe(ParticleShape.Dot);
    expect([dot.r, dot.g, dot.b]).toEqual([c[0] * 1.4, c[1] * 1.4, c[2] * 1.4]);
    expect(particles.kept[1].shape).toBe(ParticleShape.Spark);
    expect([particles.kept[1].r, particles.kept[1].gravity, particles.kept[1].drag]).toEqual([c[0] * 1.6, 7, 3.2]);
    expect([debris.kept[0].r, debris.kept[0].g, debris.kept[0].b]).toEqual(c);

    const hard = make();
    hard.fx.blockBreak(7, 3, 8, BlockType.Hard, 1, true);
    expect(hard.debris.count).toBe(3);
    const hr = c[0] + (HARD_RGB[0] - c[0]) * 0.75;
    expect(hard.debris.kept[0].r).toBeCloseTo(hr, 12);
  });

  test('前に出した演出の色が、次の演出の色に混ざらない', () => {
    const a = make();
    a.fx.blockBreak(0, 3, 8, BlockType.Ball, 1, true);
    const b = make();
    b.fx.megaBurst(0, 1, 1, 2, 1);
    b.fx.paddleSparks(0, 1, 1, 4, 1);
    b.fx.blockBreak(0, 3, 8, BlockType.Ball, 1, true);
    const la = a.particles.kept[0];
    const lb = b.particles.kept[b.particles.kept.length - 6];
    expect([lb.r, lb.g, lb.b]).toEqual([la.r, la.g, la.b]);
  });

  test('ボール大量ブロック: 輪 2 つ + 火花 3 色 × 8 個 + 破片 4 個', () => {
    const { particles, debris, fx } = make();
    fx.megaBurst(0, 4, 8, 0, 1);
    expect(particles.kept.filter((p) => p.shape === ParticleShape.Ring).length).toBe(2);
    expect(particles.kept.filter((p) => p.shape === ParticleShape.Spark).length).toBe(24);
    expect(debris.count).toBe(4);
    // 破片は最後の火花と同じ色
    const lastSpark = particles.kept[particles.kept.length - 1];
    expect(debris.kept[0].r * 1.7).toBeCloseTo(lastSpark.r, 12);
  });

  test('火花の数は budget で減るが、最低 1 個は出す', () => {
    const { particles, fx } = make();
    fx.hardSparks(0, 1, 1, 0);
    expect(particles.count).toBe(1);
    particles.count = 0;
    fx.finaleBurst(0, 1, 1, 0.5);
    expect(particles.count).toBe(1 + 20);
  });

  test('壊れないブロックの火花: 当たった点から、跳ね返ったボールの向きを中心に鋼の色で 2 個', () => {
    const { particles, fx } = make();
    fx.solidSparks(0, 3, 5, 0, -1, 1);
    expect(particles.count).toBe(2);
    for (const p of particles.kept) {
      expect([p.x, p.y]).toEqual([3, 5]);
      expect(p.shape).toBe(ParticleShape.Spark);
      expect([p.r, p.g, p.b]).toEqual([SOLID_RGB[0] * 1.3, SOLID_RGB[1] * 1.3, SOLID_RGB[2] * 1.3]);
      // 下向きを中心に ±1.1 ラジアン
      expect(Math.atan2(p.vy, p.vx)).toBeGreaterThanOrEqual(-Math.PI / 2 - 1.1 - 1e-9);
      expect(Math.atan2(p.vy, p.vx)).toBeLessThanOrEqual(-Math.PI / 2 + 1.1 + 1e-9);
    }
  });

  test('壊れないブロックが砕ける: 光の点 1 つ + 衝撃波の外向きの火花 5 個 + 鋼の色の破片 3 個', () => {
    const { particles, debris, fx } = make();
    fx.solidShatter(0, 3, 5, 0, 1, true);
    expect(particles.count).toBe(6);
    expect(debris.count).toBe(3);
    const dot = particles.kept[0];
    expect(dot.shape).toBe(ParticleShape.Dot);
    expect([dot.r, dot.g, dot.b]).toEqual([SOLID_RGB[0] * 1.4, SOLID_RGB[1] * 1.4, SOLID_RGB[2] * 1.4]);
    for (const p of particles.kept.slice(1)) {
      expect(p.shape).toBe(ParticleShape.Spark);
      expect(Math.abs(Math.atan2(p.vy, p.vx))).toBeLessThanOrEqual(1.1 + 1e-9);
    }
    expect([debris.kept[0].r, debris.kept[0].g, debris.kept[0].b]).toEqual([...SOLID_RGB]);
    const noDebris = make();
    noDebris.fx.solidShatter(0, 3, 5, 0, 1, false);
    expect(noDebris.debris.count).toBe(0);
  });

  test('スコアへの光の筋は、スコアの位置を目標にし、寿命がそのまま届くまでの時間', () => {
    const { particles, fx } = make();
    fx.setAnchor(2, 17);
    fx.finaleStreak(5, 3, 3, 4, 8, 0.6);
    const streak = particles.kept[1];
    expect(streak.shape).toBe(ParticleShape.Homing);
    expect([streak.targetX, streak.targetY, streak.life]).toEqual([2, 17, 0.6]);
    // 衝撃波の中心から外へ押し出す
    expect(streak.vy).toBeLessThan(0);
    particles.kept.length = 0;
    fx.overflowStreak(5, 3, 3);
    expect(particles.kept[0].life).toBeGreaterThanOrEqual(0.7);
    expect(particles.kept[0].life).toBeLessThanOrEqual(1);
  });

  test('目標を持たない粒は、使い回しのオブジェクトに前の目標を残さない', () => {
    const { particles, fx } = make();
    fx.setAnchor(2, 17);
    fx.overflowStreak(5, 3, 3);
    fx.hardSparks(0, 1, 1, 1);
    const last = particles.kept[particles.kept.length - 1];
    expect([last.targetX, last.targetY]).toEqual([0, 0]);
    expect(particles.specs.size).toBe(1);
  });

  test('燃え尽きる光は暗い紫', () => {
    const { particles, fx } = make();
    fx.burnOut(0, 1, 1);
    expect(particles.count).toBe(2);
    for (const p of particles.kept) expect(p.b).toBeGreaterThan(p.r);
  });

  test('着地の火花は横一列に 12 か所', () => {
    const { particles, fx } = make();
    fx.slamDust(0, 4.5);
    expect(particles.count).toBe(24);
    for (const p of particles.kept) expect(p.y).toBe(4.5);
  });
});
