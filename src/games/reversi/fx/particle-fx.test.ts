import { describe, expect, test } from 'bun:test';
import { ParticleShape } from '../../../engine/particle-spec.ts';
import type { ParticleSpec } from '../../../engine/particle-spec.ts';
import { BLACK, WHITE } from '../rules/position.ts';
import { ParticleFx } from './particle-fx.ts';

function setup() {
  const specs: (ParticleSpec & { now: number })[] = [];
  const fx = new ParticleFx({ emit: (now, p) => void specs.push({ ...p, now }) });
  return { fx, specs };
}

describe('ParticleFx', () => {
  test('人の石が着いた火花は、段階が上がるほど多く、品質の予算で減る', () => {
    const count = (tier: number, budget: number): number => {
      const { fx, specs } = setup();
      fx.impact(0, 1, 1, BLACK, 'human', tier, budget);
      return specs.length;
    };
    const full = [0, 1, 2, 3, 4].map((t) => count(t, 1));
    for (let i = 1; i < full.length; i++) expect(full[i]).toBeGreaterThan(full[i - 1]);
    expect(count(4, 0.5)).toBeLessThan(count(4, 1));
    // 予算 0 でも、着いた輪は出す
    expect(count(4, 0)).toBe(1);
  });

  test('CPU の手の粒は暗い煙と落ちる粒だけで、外へ弾ける火花や輪を出さない', () => {
    const { fx, specs } = setup();
    fx.impact(0, 1, 1, WHITE, 'cpu', 4, 1);
    fx.flipLanded(0, 1, 1, WHITE, 'cpu', 9, 1);
    expect(specs.length).toBeGreaterThan(0);
    for (const p of specs) {
      expect(p.shape).toBe(ParticleShape.Dot);
      expect(Math.max(p.r, p.g, p.b)).toBeLessThan(0.5);
    }
    // 返りきった石の粒は下へ落ちる
    for (const p of specs.filter((x) => x.gravity > 0)) expect(p.vy).toBeLessThan(0);
  });

  test('大きな手の返り始めの輪は、段階の数だけ少しずつ遅らせて重ねる', () => {
    const { fx, specs } = setup();
    fx.burst(5, 1, 1, BLACK, 4, 1);
    const rings = specs.filter((p) => p.shape === ParticleShape.Ring).map((p) => p.now);
    expect(rings).toHaveLength(4);
    for (let i = 1; i < rings.length; i++) expect(rings[i]).toBeGreaterThan(rings[i - 1]);
  });
});
