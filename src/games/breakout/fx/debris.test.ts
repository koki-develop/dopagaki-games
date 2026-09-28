import { describe, expect, test } from 'bun:test';
import { effectiveCapacity } from '../../../engine/ring.ts';
import { BLOCK_H, BLOCK_W, BlockType, FIELD_H } from '../config.ts';
import { Rng } from '../sim/rng.ts';
import { blockRgb, SOLID_RGB } from '../view/palette.ts';
import { DEBRIS_CAPACITY, DEBRIS_LIFE_MAX, DEBRIS_LIFE_MIN, DebrisFx, MAX_DEBRIS_PER_BLOCK, MAX_PIECE_AREA } from './debris.ts';
import type { DebrisSpec } from './particle-shape.ts';

type Kept = Omit<DebrisSpec, 'verts'> & { verts: number[]; now: number };

/** 渡された発生条件を、頂点も含めて写し取る */
class KeepingSink {
  readonly kept: Kept[] = [];
  readonly specs = new Set<DebrisSpec>();
  emit = (now: number, spec: DebrisSpec): void => {
    this.specs.add(spec);
    this.kept.push({ ...spec, verts: Array.from(spec.verts), now });
  };
}

function make(seed = 1) {
  const sink = new KeepingSink();
  const rng = new Rng(seed);
  return { sink, fx: new DebrisFx(sink, () => rng.next()) };
}

/** 重心基準の頂点で作る多角形の面積（反時計回りなら正） */
function area(verts: readonly number[]): number {
  let a2 = 0;
  for (let j = 0; j < 4; j++) {
    const k = (j + 1) % 4;
    a2 += verts[j * 2] * verts[k * 2 + 1] - verts[k * 2] * verts[j * 2 + 1];
  }
  return a2 / 2;
}

describe('DebrisFx', () => {
  test('ブロックの一部を小さな破片にする。数はボール入りが 2 個、ほかは 3 個', () => {
    for (const [type, n] of [
      [BlockType.Ball, 2],
      [BlockType.Hard, 3],
      [BlockType.Mega, 3],
      [BlockType.Solid, 3],
    ] as const) {
      const { sink, fx } = make();
      for (let trial = 0; trial < 50; trial++) {
        sink.kept.length = 0;
        const x = 1 + trial * 0.1;
        const y = 6;
        expect(fx.shatter(trial, x, y, type, x + 0.1, y - 1, 1)).toBe(true);
        expect(sink.kept.length).toBe(n);
        let total = 0;
        for (const p of sink.kept) {
          // どの頂点も、割れたブロックの中から出てくる
          for (let j = 0; j < 4; j++) {
            expect(Math.abs(p.x - x + p.verts[j * 2])).toBeLessThanOrEqual(BLOCK_W / 2 + 1e-12);
            expect(Math.abs(p.y - y + p.verts[j * 2 + 1])).toBeLessThanOrEqual(BLOCK_H / 2 + 1e-12);
          }
          const a = area(p.verts);
          expect(a).toBeGreaterThan(0);
          expect(a).toBeLessThanOrEqual(MAX_PIECE_AREA * (1 + 1e-9));
          total += a;
        }
        // 出した破片をすべて合わせても、ブロックの 4 分の 1 まで
        expect(total).toBeLessThanOrEqual((BLOCK_W * BLOCK_H) / 4 + 1e-12);
      }
    }
  });

  test('当たった側から押し出す: 下から当たれば上へ、上から当たれば下へ寄る', () => {
    const meanVy = (fromDy: number): number => {
      const { sink, fx } = make(5);
      for (let i = 0; i < 80; i++) fx.shatter(i, 4, 8, BlockType.Ball, 4, 8 + fromDy, 1);
      return sink.kept.reduce((s, p) => s + p.vy, 0) / sink.kept.length;
    };
    expect(meanVy(-BLOCK_H / 2)).toBeGreaterThan(0.5);
    expect(meanVy(BLOCK_H / 2)).toBeLessThan(-0.5);
    // 横から当たれば、反対の横へ寄る
    const { sink, fx } = make(5);
    for (let i = 0; i < 80; i++) fx.shatter(i, 4, 8, BlockType.Ball, 4 - BLOCK_W / 2, 8, 1);
    expect(sink.kept.reduce((s, p) => s + p.vx, 0) / sink.kept.length).toBeGreaterThan(0.5);
  });

  test('当たった点がブロックの中心と同じでも割れる', () => {
    const { sink, fx } = make();
    expect(fx.shatter(0, 4, 8, BlockType.Ball, 4, 8, 1)).toBe(true);
    for (const p of sink.kept) {
      expect(Number.isFinite(p.vx)).toBe(true);
      expect(Number.isFinite(p.vy)).toBe(true);
    }
  });

  test('色はブロックの縁の色。ボール大量ブロックは破片の位置と時刻で変わる', () => {
    const y = 9;
    const rgb: [number, number, number] = [0, 0, 0];
    for (const type of [BlockType.Ball, BlockType.Hard]) {
      const { sink, fx } = make();
      fx.shatter(0, 4, y, type, 4, y - 0.1, 1);
      blockRgb(type, y / FIELD_H, 0, 0, rgb);
      for (const p of sink.kept) expect([p.r, p.g, p.b]).toEqual(rgb);
    }
    const solid = make();
    solid.fx.shatter(0, 4, y, BlockType.Solid, 0, 0, 1);
    for (const p of solid.sink.kept) expect([p.r, p.g, p.b]).toEqual([...SOLID_RGB]);

    const mega = make();
    for (let i = 0; i < 5; i++) mega.fx.shatter(2.5, 4, y, BlockType.Mega, 4, y - 0.1, 1);
    for (const p of mega.sink.kept) {
      blockRgb(BlockType.Mega, y / FIELD_H, p.x - 4, 2.5, rgb);
      for (let ch = 0; ch < 3; ch++) expect([p.r, p.g, p.b][ch]).toBeCloseTo(rgb[ch], 9);
    }
    expect(new Set(mega.sink.kept.map((p) => `${p.r},${p.g},${p.b}`)).size).toBeGreaterThan(1);
  });

  test('寿命は範囲の中で、発生時刻は渡した now', () => {
    const { sink, fx } = make();
    fx.shatter(12.5, 4, 8, BlockType.Hard, 4, 7.8, 1);
    for (const p of sink.kept) {
      expect(p.now).toBe(12.5);
      expect(p.life).toBeGreaterThanOrEqual(DEBRIS_LIFE_MIN);
      expect(p.life).toBeLessThanOrEqual(DEBRIS_LIFE_MAX);
    }
  });

  test('発生条件は同じオブジェクトを使い回す', () => {
    const { sink, fx } = make();
    for (let i = 0; i < 10; i++) fx.shatter(i, 4, 8, BlockType.Ball, 4, 7.8, 1);
    expect(sink.specs.size).toBe(1);
  });

  for (const budget of [1, 0.4]) {
    test(`寿命の最大値の間に出す破片は、実効容量を超えない（予算 ${budget}）`, () => {
      const { sink, fx } = make(9);
      const capacity = effectiveCapacity(DEBRIS_CAPACITY, budget);
      // 120 Hz で、毎フレーム 60 個のブロックを割ろうとする
      const dt = 1 / 120;
      let refused = 0;
      for (let frame = 0; frame < 120 * 4; frame++) {
        for (let k = 0; k < 60; k++) if (!fx.shatter(frame * dt, 4, 8, BlockType.Mega, 4, 7.8, budget)) refused++;
      }
      expect(refused).toBeGreaterThan(0);
      const times = sink.kept.map((p) => p.now);
      let head = 0;
      for (let i = 0; i < times.length; i++) {
        while (times[i] - times[head] >= DEBRIS_LIFE_MAX) head++;
        expect(i - head + 1).toBeLessThanOrEqual(capacity);
      }
      // 抑えすぎていない: 長く続けたときは、実効容量のおよそ寿命あたりの割合で出し続ける
      const late = times.filter((t) => t >= 2).length;
      expect(late / 2).toBeGreaterThan((capacity * 0.8) / DEBRIS_LIFE_MAX - MAX_DEBRIS_PER_BLOCK * 120);
    });
  }
});
