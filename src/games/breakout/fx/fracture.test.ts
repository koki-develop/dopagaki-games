import { describe, expect, test } from 'bun:test';
import { Rng } from '../sim/rng.ts';
import { Fracture, fractureRect, MAX_PIECE_VERTS, MAX_PIECES, MIN_PIECES, pieceMass, rayToRect } from './fracture.ts';
import type { PieceMass } from './fracture.ts';

const HW = 0.35;
const HH = 0.2;

function vertex(f: Fracture, k: number, j: number): [number, number] {
  const o = (k * MAX_PIECE_VERTS + j) * 2;
  return [f.verts[o], f.verts[o + 1]];
}

/** 点が破片 k の内側（辺の上を含む）にあるか。破片は凸で反時計回り */
function contains(f: Fracture, k: number, x: number, y: number): boolean {
  const n = f.vertCount[k];
  for (let j = 0; j < n; j++) {
    const [x0, y0] = vertex(f, k, j);
    const [x1, y1] = vertex(f, k, (j + 1) % n);
    if ((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0) < -1e-12) return false;
  }
  return true;
}

describe('rayToRect', () => {
  test('出発点から輪郭までの倍率', () => {
    expect(rayToRect(1, 0.5, 0, 0, 1, 0)).toBe(1);
    expect(rayToRect(1, 0.5, 0, 0, 0, -1)).toBe(0.5);
    expect(rayToRect(1, 0.5, 0.5, 0, -1, 0)).toBe(1.5);
    // 斜めは先に着く辺で決まる
    expect(rayToRect(1, 0.5, 0, 0, Math.SQRT1_2, Math.SQRT1_2)).toBeCloseTo(0.5 * Math.SQRT2, 12);
  });
});

describe('fractureRect', () => {
  test('どの破断点でも、破片は凸の三角形か四角形で、重ならずに矩形をちょうど覆う', () => {
    const rng = new Rng(7);
    const rand = () => rng.next();
    const f = new Fracture();
    const mass: PieceMass = { x: 0, y: 0, area: 0 };
    for (let trial = 0; trial < 3000; trial++) {
      // 輪郭のすぐそばまで含めて、破断点を散らす
      const ox = (rand() * 2 - 1) * HW * 0.98;
      const oy = (rand() * 2 - 1) * HH * 0.98;
      const pieces = 1 + Math.floor(rand() * 10);
      fractureRect(HW, HH, ox, oy, pieces, rand, f);

      expect(f.count).toBeGreaterThanOrEqual(Math.max(MIN_PIECES, Math.min(MAX_PIECES, pieces)));
      expect(f.count).toBeLessThanOrEqual(MAX_PIECES);
      let area = 0;
      for (let k = 0; k < f.count; k++) {
        const n = f.vertCount[k];
        expect(n === 3 || n === 4).toBe(true);
        expect(vertex(f, k, 0)).toEqual([ox, oy]);
        for (let j = 0; j < n; j++) {
          const [x0, y0] = vertex(f, k, j);
          const [x1, y1] = vertex(f, k, (j + 1) % n);
          const [x2, y2] = vertex(f, k, (j + 2) % n);
          expect(Math.abs(x0)).toBeLessThanOrEqual(HW + 1e-12);
          expect(Math.abs(y0)).toBeLessThanOrEqual(HH + 1e-12);
          // 凸で反時計回り: 続く 2 辺の外積が正
          expect((x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1)).toBeGreaterThan(0);
        }
        area += pieceMass(f, k, mass).area;
        expect(contains(f, k, mass.x, mass.y)).toBe(true);
      }
      expect(area).toBeCloseTo(4 * HW * HH, 10);

      // 矩形の中の点は、ちょうど 1 つの破片に入る（辺の上の点を避けるため、点は乱数で取る）
      for (let s = 0; s < 8; s++) {
        const px = (rand() * 2 - 1) * HW;
        const py = (rand() * 2 - 1) * HH;
        let inside = 0;
        for (let k = 0; k < f.count; k++) if (contains(f, k, px, py)) inside++;
        expect(inside).toBe(1);
      }
    }
  });

  test('破断点に近い破片ほど小さい', () => {
    const rng = new Rng(3);
    const rand = () => rng.next();
    const f = new Fracture();
    const mass: PieceMass = { x: 0, y: 0, area: 0 };
    // 破断点を下の辺の近くに置くと、下の辺に接する破片は、上の辺に接する破片より小さくなる
    let near = 0;
    let far = 0;
    for (let trial = 0; trial < 200; trial++) {
      fractureRect(HW, HH, 0, -HH * 0.7, 6, rand, f);
      for (let k = 0; k < f.count; k++) {
        pieceMass(f, k, mass);
        if (mass.y < -HH * 0.5) near += mass.area;
        else if (mass.y > 0) far += mass.area;
      }
    }
    expect(far).toBeGreaterThan(near * 2);
  });

  test('同じ乱数の列なら同じ割れ方', () => {
    const a = new Rng(11);
    const b = new Rng(11);
    const fa = fractureRect(HW, HH, 0.1, -0.05, 6, () => a.next(), new Fracture());
    const fb = fractureRect(HW, HH, 0.1, -0.05, 6, () => b.next(), new Fracture());
    expect(fa.count).toBe(fb.count);
    expect(Array.from(fa.verts)).toEqual(Array.from(fb.verts));
  });
});
