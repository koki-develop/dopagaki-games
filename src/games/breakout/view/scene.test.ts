import { describe, expect, test } from 'bun:test';
import type * as THREE from 'three/webgpu';
import type { CameraOffset } from '../../../juice/camera.ts';
import type { FrameTime } from '../frame-time.ts';
import { createFxState, PRESENT_LONG_AGO, SHOCK_SPEED_IDLE, WALL_HIT_SLOTS } from '../fx/fx-state.ts';
import type { FxState } from '../fx/fx-state.ts';
import { Sim } from '../sim/sim.ts';
import { makeSim, stageMode } from '../sim/sim.test-support.ts';
import { computeLayout } from './layout.ts';
import { LOOK } from './look.ts';
import { BreakoutView } from './scene.ts';

const still: CameraOffset = { x: 0, y: 0, rotation: 0, zoom: 1 };
const frameAt = (present: number): FrameTime => ({ realDt: 1 / 60, worldDt: 1 / 60, real: 0, world: 0, present });

/** 決まった値を入れた FxState（どの値もほかと区別できる） */
function busyFx(): FxState {
  const fx = createFxState(true, 0.9, 0.6);
  Object.assign(fx, {
    beat: 0.5,
    intensity: 0.25,
    tier: 2.5,
    hue: 1.25,
    glow: 0.375,
    danger: 0.75,
    flash: 0.125,
    inhale: 0.0625,
    vignette: 0.5,
    focusX: 3,
    focusY: 12,
    shockX: 4,
    shockY: 11,
    shockStart: 123,
    shockSpeed: 15.5,
    paddleSquashX: 1.25,
    paddleSquashY: 0.75,
    paddleFlash: 0.5,
  });
  for (let i = 0; i < fx.wallHits.length; i++) fx.wallHits[i] = i + 0.5;
  return fx;
}

class BloomSpy {
  readonly calls: [number, number, number][] = [];
  setBloom(strength: number, radius: number, threshold: number): void {
    this.calls.push([strength, radius, threshold]);
  }
}

describe('BreakoutView.apply', () => {
  test('FxState のすべての値を uniform・パドル・bloom へ写し、u.time は present', () => {
    const view = new BreakoutView();
    const bloom = new BloomSpy();
    view.setPost(bloom);
    const fx = busyFx();
    view.apply(fx, frameAt(42));
    const u = view.uniforms;
    expect(u.time.value).toBe(42);
    expect([u.beat.value, u.intensity.value, u.tier.value, u.hue.value, u.glow.value, u.danger.value]).toEqual([0.5, 0.25, 2.5, 1.25, 0.375, 0.75]);
    expect([u.endless.value, u.flash.value, u.inhale.value, u.vignette.value]).toEqual([1, 0.125, 0.0625, 0.5]);
    expect(u.shock.value.toArray()).toEqual([4, 11, 123, 15.5]);
    expect(u.focus.value.toArray()).toEqual([3, 12]);
    const hits = u.wallHits.array as THREE.Vector4[];
    for (let i = 0; i < WALL_HIT_SLOTS; i++) expect(Array.from(hits[i].toArray())).toEqual(Array.from(fx.wallHits.subarray(i * 4, i * 4 + 4)));
    expect(view.paddle.squash.value.toArray()).toEqual([1.25, 0.75]);
    expect(view.paddle.flash.value).toBe(0.5);
    expect(bloom.calls.at(-1)).toEqual([0.9, 0.6, LOOK.bloom.threshold]);
    view.dispose();
  });

  test('新しい FxState を写すと、前のプレイの値は何も残らない', () => {
    const view = new BreakoutView();
    view.apply(busyFx(), frameAt(42));
    view.apply(createFxState(false), frameAt(50));
    const u = view.uniforms;
    expect([u.flash.value, u.inhale.value, u.vignette.value, u.danger.value, u.endless.value]).toEqual([0, 0, 0, 0, 0]);
    expect(u.shock.value.toArray()).toEqual([0, 0, PRESENT_LONG_AGO, SHOCK_SPEED_IDLE]);
    for (const h of u.wallHits.array as THREE.Vector4[]) expect(h.toArray()).toEqual([0, Math.fround(PRESENT_LONG_AGO), -1, 0]);
    expect(view.paddle.squash.value.toArray()).toEqual([1, 1]);
    view.dispose();
  });

  test('作った直後の uniform は、何も起きていない FxState を写したものと同じ', () => {
    const fresh = new BreakoutView();
    const applied = new BreakoutView();
    applied.apply(createFxState(false), frameAt(0));
    const values = (v: BreakoutView) =>
      Object.values(v.uniforms).map((n) => {
        const value = (n as { value?: unknown }).value;
        if (value && typeof (value as { toArray?: unknown }).toArray === 'function') return (value as THREE.Vector4).toArray();
        if (value !== undefined) return value;
        return ((n as { array: THREE.Vector4[] }).array ?? []).map((h) => h.toArray());
      });
    expect(values(fresh)).toEqual(values(applied));
    fresh.dispose();
    applied.dispose();
  });

  test('bloom は値が変わったときだけ送る', () => {
    const view = new BreakoutView();
    const bloom = new BloomSpy();
    view.setPost(bloom);
    expect(bloom.calls.length).toBe(1);
    const fx = createFxState(false);
    view.apply(fx, frameAt(1));
    view.apply(fx, frameAt(2));
    expect(bloom.calls.length).toBe(1);
    fx.bloomStrength += 0.1;
    view.apply(fx, frameAt(3));
    expect(bloom.calls.length).toBe(2);
    view.dispose();
  });
});

describe('BreakoutView.sync', () => {
  test('フラッシュと縁の絞り込みは、値が 0 のとき描かない', () => {
    const view = new BreakoutView();
    const src = { sim: Sim.idle(), presentOffset: 0 };
    const fx = createFxState(false);
    view.apply(fx, frameAt(0));
    view.sync(src, 0, 4.5, still, false);
    expect(view.flash.mesh.visible).toBe(false);
    expect(view.vignette.mesh.visible).toBe(false);
    fx.flash = 1e-3;
    fx.vignette = 0.2;
    view.apply(fx, frameAt(0));
    view.sync(src, 0, 4.5, still, false);
    expect(view.flash.mesh.visible).toBe(true);
    expect(view.vignette.mesh.visible).toBe(true);
    view.dispose();
  });

  test('ブロックは、格子の version と時刻のずれが前回と同じなら書き出し直さない', () => {
    const view = new BreakoutView();
    const sim = makeSim(stageMode(['oooooooooooo', '............', 'o...........']));
    view.sync({ sim, presentOffset: 5 }, 0, 4.5, still, false);
    const count = view.blocks.mesh.count;
    expect(count).toBe(13);
    // 書き出したら描画数を入れ直すので、書き出したかを描画数で見分ける
    view.blocks.mesh.count = -1;
    view.sync({ sim, presentOffset: 5 }, 0, 4.5, still, false);
    expect(view.blocks.mesh.count).toBe(-1);
    view.sync({ sim, presentOffset: 6 }, 0, 4.5, still, false);
    expect(view.blocks.mesh.count).toBe(count);
    view.blocks.mesh.count = -1;
    view.invalidateGpu();
    view.sync({ sim, presentOffset: 6 }, 0, 4.5, still, false);
    expect(view.blocks.mesh.count).toBe(count);
    view.dispose();
  });

  test('カメラは配置の範囲を写し、揺れの分だけずらす', () => {
    const view = new BreakoutView();
    const layout = computeLayout(390, 844, 60, 20);
    view.setLayout(layout);
    view.sync({ sim: Sim.idle(), presentOffset: 0 }, 0, 4.5, { x: 0.25, y: -0.5, rotation: 0.01, zoom: 1 }, false);
    const c = view.camera;
    expect(c.right - c.left).toBeCloseTo(layout.right - layout.left, 9);
    expect(c.top - c.bottom).toBeCloseTo(layout.top - layout.bottom, 9);
    expect(c.position.x).toBeCloseTo(4.5 + 0.25, 9);
    expect(c.rotation.z).toBeCloseTo(0.01, 9);
    view.dispose();
  });
});
