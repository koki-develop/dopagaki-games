import { describe, expect, test } from 'bun:test';
import { DANGER_Y, FIELD_H, FIELD_W } from '../config.ts';
import { LOOK } from './look.ts';
import { cellRandom, cellRandomTable } from './cell-random.ts';
import { DENSITY_H, DENSITY_W, DensityGrid, isWarpActive, WARP_TIER_START } from './density.ts';
import {
  GPU_MARGIN,
  WALL_GLOW_REACH,
  WALL_WAVE,
  WALL_WAVE_EPSILON,
  wallGlow,
  wallWaveBounds,
} from './wall-wave.ts';
import {
  DANGER_LINE,
  dangerReach,
  farWallNegligible,
  NO_REACH,
  SHOCK_RING,
  shockAge,
  shockReach,
  SKIP_EPSILON,
  WALL_GLOW_BAND,
} from './background-reach.ts';
import type { WallHit, WallWaveBounds } from './wall-wave.ts';

/** 決まった種から同じ列を返す乱数 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idleHit = (): WallHit => ({ x: 0, y: -100, z: -1, w: 0 });
const newBounds = (): WallWaveBounds => ({ left: 0, right: 0, shiftLeft: 0, shiftRight: 0 });

/** シェーダーと同じ式で、壁の変位（左, 右）を求める */
function displacement(hits: readonly WallHit[], time: number, py: number): [number, number] {
  let l = 0;
  let r = 0;
  for (const h of hits) {
    const age = time - h.y;
    const dy = Math.abs(py - h.x);
    const wave =
      Math.exp(-WALL_WAVE.decay * age) *
      Math.sin(WALL_WAVE.freq * age - WALL_WAVE.spatial * dy) *
      Math.exp(-WALL_WAVE.spread * dy) *
      h.w *
      (age >= 0 ? 1 : 0);
    if (h.z <= 0) l += wave;
    if (h.z >= 0) r += wave;
  }
  return [l, r];
}

/** シェーダーと同じ式で、壁と天井の光（壁の色を掛ける前）を求める */
function frameGlow(px: number, py: number, dispL: number, dispR: number): number {
  const above = Math.max(py - FIELD_H, 0);
  const dl = Math.hypot(px - dispL * WALL_WAVE.amp, above);
  const dr = Math.hypot(px - (FIELD_W + dispR * WALL_WAVE.amp), above);
  const beside = Math.max(Math.max(-px, px - FIELD_W), 0);
  const dc = Math.hypot(beside, py - FIELD_H);
  return wallGlow(Math.min(dl, dr, dc));
}

describe('wallWaveBounds', () => {
  test('揺れていなければ、どの画素でも計算しない', () => {
    const hits = Array.from({ length: 8 }, idleHit);
    const b = wallWaveBounds(hits, 0, newBounds());
    expect(b.left).toBeLessThan(-1e5);
    expect(b.right).toBeGreaterThan(FIELD_W + 1e5);
  });

  test('まだ始まっていない記録は数えない', () => {
    const hits = [{ x: 8, y: 10, z: -1, w: 1.4 }, ...Array.from({ length: 7 }, idleHit)];
    const b = wallWaveBounds(hits, 9.5, newBounds());
    expect(b.left).toBeLessThan(-1e5);
  });

  test('向きが左なら左だけ、0 なら左右とも広がる', () => {
    const left = wallWaveBounds([{ x: 8, y: 1, z: -1, w: 1 }], 1, newBounds());
    expect(left.left).toBeCloseTo(WALL_WAVE.amp * 1.001 + WALL_GLOW_REACH, 9);
    expect(left.right).toBeGreaterThan(FIELD_W + 1e5);
    const both = wallWaveBounds([{ x: 8, y: 1, z: 0, w: 1 }], 1, newBounds());
    expect(both.left).toBeCloseTo(left.left, 12);
    expect(both.right).toBeCloseTo(FIELD_W - left.left, 12);
  });

  test('壁のずれの上限は、始まった記録の |w|·e^(-decay·age) の和に amp を掛けたもの', () => {
    const hits = [
      { x: 3, y: 9.9, z: -1, w: 1.2 },
      { x: 8, y: 9.5, z: 1, w: -0.8 },
      { x: 5, y: 9.8, z: 0, w: 0.5 },
      { x: 5, y: 10.5, z: -1, w: 1.4 },
    ];
    const b = wallWaveBounds(hits, 10, newBounds());
    const m = (w: number, age: number) => Math.abs(w) * Math.exp(-WALL_WAVE.decay * age);
    expect(b.shiftLeft).toBeCloseTo(WALL_WAVE.amp * (m(1.2, 0.1) + m(0.5, 0.2)) * GPU_MARGIN, 6);
    expect(b.shiftRight).toBeCloseTo(WALL_WAVE.amp * (m(0.8, 0.5) + m(0.5, 0.2)) * GPU_MARGIN, 6);
    expect(b.left).toBeCloseTo(b.shiftLeft + WALL_GLOW_REACH, 9);
  });

  test('WALL_GLOW_REACH では壁の光が ε 以下で、それより手前では ε を超える', () => {
    expect(LOOK.background.wall * wallGlow(WALL_GLOW_REACH)).toBeLessThanOrEqual(WALL_WAVE_EPSILON);
    expect(LOOK.background.wall * wallGlow(WALL_GLOW_REACH - 1e-3)).toBeGreaterThan(WALL_WAVE_EPSILON);
  });

  test('範囲の外では、揺れを省いても色の差が ε 以下', () => {
    const rand = rng(7);
    let checked = 0;
    let worst = 0;
    for (let trial = 0; trial < 400; trial++) {
      const time = 10 + rand() * 5;
      const hits: WallHit[] = Array.from({ length: 8 }, () =>
        rand() < 0.2
          ? idleHit()
          : { x: rand() * FIELD_H, y: time - rand() * rand() * 2, z: rand() < 0.5 ? -1 : 1, w: 0.7 + rand() * 0.7 },
      );
      const b = wallWaveBounds(hits, time, newBounds());
      for (let k = 0; k < 200; k++) {
        // 半分は範囲の境目のすぐ外から選ぶ
        const edge = rand() < 0.5 ? b.left + rand() * 0.05 : b.right - rand() * 0.05;
        const px = rand() < 0.5 && Math.abs(edge) < 100 ? edge : -3 + rand() * (FIELD_W + 6);
        const py = -3 + rand() * (FIELD_H + 6);
        if (px < b.left || px > b.right) continue;
        const [l, r] = displacement(hits, time, py);
        const diff = LOOK.background.wall * Math.abs(frameGlow(px, py, l, r) - frameGlow(px, py, 0, 0));
        worst = Math.max(worst, diff);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10000);
    expect(worst).toBeLessThanOrEqual(WALL_WAVE_EPSILON);
  });

  test('壁のすぐそばの画素は範囲に入る', () => {
    const b = wallWaveBounds([{ x: 8, y: 0, z: 1, w: 1.4 }, { x: 3, y: 0, z: -1, w: 0.7 }], 0.01, newBounds());
    expect(b.left).toBeGreaterThan(WALL_GLOW_REACH);
    expect(b.right).toBeLessThan(FIELD_W - WALL_GLOW_REACH);
  });
});

describe('cellRandom', () => {
  test('表の値は sin のハッシュを f32 に丸めたもの', () => {
    const t = cellRandomTable(768);
    for (let i = 0; i < t.length; i++) {
      const v = Math.sin((i + 1) * 12.9898) * 43758.5453;
      expect(t[i]).toBe(Math.fround(v - Math.floor(v)));
      expect(t[i]).toBe(Math.fround(cellRandom(i)));
      expect(t[i]).toBeGreaterThanOrEqual(0);
      expect(t[i]).toBeLessThanOrEqual(1);
    }
  });

  test('作るたびに同じ表になる', () => {
    expect(cellRandomTable(100)).toEqual(cellRandomTable(100));
  });
});

describe('DensityGrid', () => {
  /** 密度の定義（毎フレーム 0.82 倍に減衰し、ボール 1 個につき 0.05 を足す）どおりに求める参照実装 */
  function reference(frames: [number[], number[]][]): Uint8Array {
    const acc = new Float32Array(DENSITY_W * DENSITY_H);
    const out = new Uint8Array(acc.length);
    for (const [xs, ys] of frames) {
      for (let i = 0; i < acc.length; i++) acc[i] *= 0.82;
      for (let i = 0; i < xs.length; i++) {
        const cx = Math.floor(xs[i] * (DENSITY_W / FIELD_W));
        const cy = Math.floor(ys[i] * (DENSITY_H / FIELD_H));
        if (cx < 0 || cx >= DENSITY_W || cy < 0 || cy >= DENSITY_H) continue;
        acc[cy * DENSITY_W + cx] += 0.05;
      }
      for (let i = 0; i < acc.length; i++) out[i] = Math.min(255, acc[i] * 255) | 0;
    }
    return out;
  }

  test('密度の値は毎フレームの減衰と加算で決まる', () => {
    const rand = rng(3);
    const frames: [number[], number[]][] = [];
    const g = new DensityGrid();
    for (let f = 0; f < 60; f++) {
      const n = Math.floor(rand() * 300);
      const xs = Array.from({ length: n }, () => -1 + rand() * (FIELD_W + 2));
      const ys = Array.from({ length: n }, () => -1 + rand() * (FIELD_H + 2));
      frames.push([xs, ys]);
      g.accumulate(xs, ys, n);
    }
    expect(Array.from(g.data)).toEqual(Array.from(reference(frames)));
  });

  test('読まれていない間は送らず、読まれ始めたら変化を 1 回だけ送る', () => {
    const g = new DensityGrid();
    expect(g.takeUpload(true)).toBe(false);
    g.accumulate([4.5], [8], 1);
    expect(g.takeUpload(false)).toBe(false);
    expect(g.takeUpload(false)).toBe(false);
    expect(g.takeUpload(true)).toBe(true);
    expect(g.takeUpload(true)).toBe(false);
  });

  test('値が変わらなければ送らない', () => {
    const g = new DensityGrid();
    g.accumulate([], [], 0);
    expect(g.takeUpload(true)).toBe(false);
    g.reset();
    expect(g.takeUpload(true)).toBe(false);
    for (let i = 0; i < 5; i++) g.accumulate([4.5], [8], 1);
    expect(g.takeUpload(true)).toBe(true);
    g.reset();
    expect(g.data.every((v) => v === 0)).toBe(true);
    expect(g.takeUpload(true)).toBe(true);
  });

  test('歪みの判定は f32 の比較と一致する', () => {
    const start = Math.fround(WARP_TIER_START);
    expect(isWarpActive(0)).toBe(false);
    expect(isWarpActive(WARP_TIER_START)).toBe(false);
    expect(isWarpActive(start)).toBe(false);
    // f32 にすると 2.4 と同じ値になる数は、シェーダーでも歪まない
    expect(isWarpActive(start + 1e-9)).toBe(false);
    const next = new Float32Array([start]);
    new Uint32Array(next.buffer)[0]++;
    expect(isWarpActive(next[0])).toBe(true);
    expect(isWarpActive(4)).toBe(true);
  });
});

describe('背景の項を省く範囲', () => {
  const WALL_MAX = LOOK.background.wall;

  test('省く誤差の合計は 1e-4 より小さく、丸めの差のための余裕が残る', () => {
    const sum = Object.values(SKIP_EPSILON).reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(8.1e-5);
  });

  test('WALL_GLOW_BAND では壁の光が ε 以下で、それより手前では ε を超える', () => {
    expect(WALL_MAX * wallGlow(WALL_GLOW_BAND) * GPU_MARGIN).toBeLessThanOrEqual(SKIP_EPSILON.glow);
    expect(WALL_MAX * wallGlow(WALL_GLOW_BAND - 1e-3)).toBeGreaterThan(SKIP_EPSILON.glow);
  });

  test('光の帯の外では、揺れを計算してもしなくても、光は ε 以下', () => {
    const rand = rng(11);
    let checked = 0;
    let worst = 0;
    for (let trial = 0; trial < 300; trial++) {
      const time = 20 + rand() * 5;
      const hits: WallHit[] = Array.from({ length: 8 }, () =>
        rand() < 0.2
          ? idleHit()
          : { x: rand() * FIELD_H, y: time - rand() * rand() * 2, z: rand() < 0.4 ? -1 : rand() < 0.8 ? 1 : 0, w: 0.7 + rand() * 0.7 },
      );
      const b = wallWaveBounds(hits, time, newBounds());
      const reachL = b.shiftLeft + WALL_GLOW_BAND;
      const reachR = b.shiftRight + WALL_GLOW_BAND;
      for (let k = 0; k < 300; k++) {
        // 半分は帯の境目のすぐ外から選ぶ
        const pick = rand();
        const edge = rand() * 0.05;
        const anywhere = -4 + rand() * (FIELD_W + 8);
        const px = pick < 0.25 ? reachL + edge : pick < 0.5 ? FIELD_W - reachR - edge : pick < 0.6 ? -reachL - edge : anywhere;
        const py = rand() < 0.3 ? FIELD_H - WALL_GLOW_BAND - rand() * 0.05 : -4 + rand() * (FIELD_H + 8);
        if (Math.abs(px) < reachL || Math.abs(px - FIELD_W) < reachR || Math.abs(py - FIELD_H) < WALL_GLOW_BAND) continue;
        const [l, r] = displacement(hits, time, py);
        worst = Math.max(worst, WALL_MAX * frameGlow(px, py, l, r), WALL_MAX * frameGlow(px, py, 0, 0));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20000);
    expect(worst).toBeLessThanOrEqual(SKIP_EPSILON.glow);
  });

  test('近い側の壁の記録だけで揺れを計算しても、光の差は ε 以下', () => {
    const rand = rng(13);
    let used = 0;
    let worst = 0;
    for (let trial = 0; trial < 300; trial++) {
      const time = 20 + rand() * 5;
      const hits: WallHit[] = Array.from({ length: 8 }, () => ({
        x: rand() * FIELD_H,
        y: time - rand() * rand() * 2,
        z: rand() < 0.4 ? -1 : rand() < 0.8 ? 1 : 0,
        w: 0.5 + rand(),
      }));
      const b = wallWaveBounds(hits, time, newBounds());
      if (!farWallNegligible(b)) continue;
      used++;
      for (let k = 0; k < 100; k++) {
        const px = -3 + rand() * (FIELD_W + 6);
        const py = -3 + rand() * (FIELD_H + 6);
        const [l, r] = displacement(hits, time, py);
        // 左半分の画素は向き ≤ 0 の記録だけ、右半分は向き ≥ 0 の記録だけを足す
        const near = hits.filter((h) => (px < FIELD_W / 2 ? h.z <= 0 : h.z >= 0));
        const [nl, nr] = displacement(near, time, py);
        if (px < FIELD_W / 2) expect(nl).toBe(l);
        else expect(nr).toBe(r);
        worst = Math.max(worst, WALL_MAX * Math.abs(frameGlow(px, py, l, r) - frameGlow(px, py, nl, nr)));
      }
    }
    expect(used).toBeGreaterThan(200);
    expect(worst).toBeLessThanOrEqual(SKIP_EPSILON.farWall);
  });

  test('反対側の壁の揺れが大きすぎるときは、近い側だけで計算しない', () => {
    const shift = FIELD_W / 2 - 1;
    expect(farWallNegligible({ ...newBounds(), shiftLeft: shift })).toBe(false);
    expect(farWallNegligible({ ...newBounds(), shiftRight: FIELD_W })).toBe(false);
    expect(farWallNegligible({ ...newBounds(), shiftLeft: 0.5, shiftRight: 0.5 })).toBe(true);
  });

  /** シェーダーと同じ式で、危険ラインの色の最も大きい成分を求める */
  function dangerTerm(py: number, px: number, time: number, danger: number, endless: number): number {
    const L = DANGER_LINE;
    const dd = Math.abs(py - DANGER_Y);
    const f = px * 1.6 - time * 0.4;
    const dash = f - Math.floor(f) >= 0.45 ? 1 : 0;
    const pulse = Math.sin(time * 6.28318 * 0.9) * 0.5 + 0.5;
    const level = L.base + danger * danger * (pulse * L.pulseGain + L.pulseBase);
    const v = (Math.exp(-L.sharp * dd) * dash + Math.exp(-L.soft * dd) * danger * L.softGain) * level * endless;
    return Math.max(...L.color) * v;
  }

  test('エンドレスでなければ危険ラインは計算しない', () => {
    expect(dangerReach(0, 0)).toBe(NO_REACH);
    expect(dangerReach(1, 0)).toBe(NO_REACH);
  });

  test('危険ラインは、範囲の外では ε 以下で、範囲の境目のすぐ内側では ε を超えうる', () => {
    const rand = rng(17);
    let worst = 0;
    for (let trial = 0; trial < 2000; trial++) {
      const danger = rand() < 0.2 ? 0 : rand();
      const reach = dangerReach(danger, 1);
      expect(reach).toBeGreaterThan(0);
      for (let k = 0; k < 40; k++) {
        const dd = reach + (rand() < 0.5 ? rand() * 1e-3 : rand() * 4);
        const py = DANGER_Y + (rand() < 0.5 ? dd : -dd);
        worst = Math.max(worst, dangerTerm(py, rand() * FIELD_W, 10 + rand() * 100, danger, 1));
      }
      // 境目の少し内側で、脈動と破線が最大になる画素は ε を超える
      const L = DANGER_LINE;
      const inner = reach * 0.98;
      const level = L.base + danger * danger * (L.pulseGain + L.pulseBase);
      const peak = level * (Math.exp(-L.sharp * inner) + L.softGain * danger * Math.exp(-L.soft * inner));
      expect(peak).toBeGreaterThan(SKIP_EPSILON.danger);
    }
    expect(worst).toBeLessThanOrEqual(SKIP_EPSILON.danger);
  });

  /** シェーダーと同じ式で、衝撃波の色の最も大きい成分を求める */
  function shockTerm(r: number, age: number): number {
    const S = SHOCK_RING;
    return Math.max(...S.color) * LOOK.background.shock * Math.exp(-S.width * r * r) * Math.exp(-S.decay * age) * (age >= 0 ? 1 : 0);
  }

  test('始まっていない衝撃波と、十分に弱まった衝撃波は計算しない', () => {
    expect(shockReach(10, 10.5)).toBe(NO_REACH);
    expect(shockReach(10, 10 + 1e-6)).toBe(NO_REACH);
    expect(shockReach(10, -1e4)).toBe(NO_REACH);
    expect(shockReach(10, 2)).toBe(NO_REACH);
    expect(shockReach(10, 10)).toBeGreaterThan(0);
    // 弱まって計算しなくなる時刻では、輪の頂点でも ε 以下
    for (let age = 0; age < 20; age += 0.01) {
      if (shockReach(10 + age, 10) === NO_REACH) {
        expect(shockTerm(0, age)).toBeLessThanOrEqual(SKIP_EPSILON.shock);
      }
    }
  });

  test('衝撃波は、前線から範囲より離れた画素では ε 以下', () => {
    const rand = rng(19);
    let worst = 0;
    let checked = 0;
    for (let trial = 0; trial < 2000; trial++) {
      const start = 10 + rand() * 1000;
      const time = start + rand() * rand() * 8;
      const band = shockReach(time, start);
      if (band === NO_REACH) continue;
      const age = shockAge(time, start);
      for (let k = 0; k < 20; k++) {
        const r = band + (rand() < 0.5 ? rand() * 1e-3 : rand() * 3);
        worst = Math.max(worst, shockTerm(r, age));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20000);
    expect(worst).toBeLessThanOrEqual(SKIP_EPSILON.shock);
  });

  test('衝撃波の経過時間は、f32 に丸めた時刻の差を f32 に丸めたもの', () => {
    const time = 1834.61;
    const start = 1834.27;
    expect(shockAge(time, start)).toBe(Math.fround(Math.fround(time) - Math.fround(start)));
    expect(shockAge(time, start)).not.toBe(time - start);
  });
});
