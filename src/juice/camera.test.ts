import { describe, expect, test } from 'bun:test';
import { CameraRig } from './camera.ts';
import type { CameraOffset } from './camera.ts';

describe('CameraRig', () => {
  const opts = { maxOffset: 0.4, maxRotation: 0.05, decayPerSecond: 1, frequency: 20 };
  const out: CameraOffset = { x: 0, y: 0, rotation: 0, zoom: 1 };
  const full = { shake: 1, pulse: 1, pull: 1, punch: 1, jolt: 1 };

  test('揺れは trauma² に比例し、揺れの倍率 0 なら揺れない', () => {
    const cam = new CameraRig(opts);
    cam.addTrauma(0.5);
    cam.update(0.013);
    let maxHalf = 0;
    for (let i = 0; i < 200; i++) {
      cam.trauma = 0.5;
      cam.update(0.01);
      cam.sample(full, out);
      maxHalf = Math.max(maxHalf, Math.abs(out.x));
    }
    expect(maxHalf).toBeLessThanOrEqual(opts.maxOffset * 0.25 + 1e-9);
    cam.sample({ ...full, shake: 0 }, out);
    expect(Math.abs(out.x)).toBe(0);
    expect(Math.abs(out.rotation)).toBe(0);
  });

  test('trauma は 1 を超えず、時間とともに線形に減る', () => {
    const cam = new CameraRig(opts);
    cam.addTrauma(0.8);
    cam.addTrauma(0.8);
    expect(cam.trauma).toBe(1);
    cam.update(0.25);
    expect(cam.trauma).toBeCloseTo(0.75, 9);
    cam.update(5);
    expect(cam.trauma).toBe(0);
  });

  test('引きはズームを下げてから 1 に戻る', () => {
    const cam = new CameraRig(opts);
    cam.pull(0.1, 0.1, 0.5);
    cam.update(0.1);
    cam.sample(full, out);
    expect(out.zoom).toBeCloseTo(0.9, 6);
    cam.update(0.6);
    cam.sample(full, out);
    expect(out.zoom).toBeCloseTo(1, 6);
    cam.pull(0.1, 0.1, 0.5);
    cam.update(0.1);
    cam.sample({ ...full, pull: 0.3 }, out);
    expect(out.zoom).toBeCloseTo(0.97, 6);
  });

  test('衝撃に伴う引き（punch）は punch の倍率だけを掛け、大きな節目の引きは pull の倍率だけを掛ける', () => {
    const cam = new CameraRig(opts);
    cam.punch(0.1, 0.1, 0.5);
    cam.update(0.1);
    cam.sample(full, out);
    expect(out.zoom).toBeCloseTo(0.9, 6);
    cam.sample({ ...full, pull: 0 }, out);
    expect(out.zoom).toBeCloseTo(0.9, 6);
    cam.sample({ ...full, punch: 0.3 }, out);
    expect(out.zoom).toBeCloseTo(0.97, 6);
    cam.sample({ ...full, punch: 0 }, out);
    expect(out.zoom).toBe(1);
    cam.pull(0.1, 0.1, 0.5);
    cam.update(0.1);
    // punch は戻り始め、pull は引ききったところ
    cam.sample({ ...full, punch: 0 }, out);
    expect(out.zoom).toBeCloseTo(0.9, 6);
  });

  test('ビートの拍動は拍動の倍率だけで決まり、0 なら止まる。揺れと引きの倍率には左右されない', () => {
    const cam = new CameraRig(opts);
    cam.beatAmount = 0.012;
    cam.beatEnvelope = 1;
    cam.sample(full, out);
    expect(out.zoom).toBeCloseTo(1.012, 9);
    cam.sample({ shake: 0, pulse: 1, pull: 0, punch: 0, jolt: 0 }, out);
    expect(out.zoom).toBeCloseTo(1.012, 9);
    cam.sample({ ...full, pulse: 0.3 }, out);
    expect(out.zoom).toBeCloseTo(1.0036, 9);
    cam.sample({ ...full, pulse: 0 }, out);
    expect(out.zoom).toBe(1);
  });

  test('引く時間や戻す時間が 0 の引きでも、ズームは数のまま', () => {
    const cam = new CameraRig(opts);
    cam.pull(0.1, 0, 0);
    cam.punch(0.1, 0, 0.5);
    cam.sample(full, out);
    expect(Number.isFinite(out.zoom)).toBe(true);
    expect(out.zoom).toBeCloseTo(0.9, 6);
    cam.update(0.25);
    cam.sample(full, out);
    expect(Number.isFinite(out.zoom)).toBe(true);
    expect(out.zoom).toBeGreaterThan(0.9);
  });
});
