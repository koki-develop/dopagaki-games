import { describe, expect, test } from 'bun:test';
import { FixedStepper, FrameLoop, MAX_FRAME_DT } from './frame-loop.ts';
import type { FrameClient, FrameTarget, LoopFrame } from './frame-loop.ts';
import { QualityGovernor } from './quality.ts';

class FakeTarget implements FrameTarget {
  cb: ((time?: number) => void) | null = null;
  renders = 0;
  setAnimationLoop(cb: ((time?: number) => void) | null): void {
    this.cb = cb;
  }
  render(): void {
    this.renders++;
  }
}

class FakeClient implements FrameClient {
  frames: LoopFrame[] = [];
  dirty = false;
  qualityChanges: number[] = [];
  errors: unknown[] = [];
  fail: Error | null = null;
  onQualityChange(level: number): void {
    this.qualityChanges.push(level);
  }
  update(frame: Readonly<LoopFrame>): boolean {
    if (this.fail) throw this.fail;
    this.frames.push({ ...frame });
    return this.dirty;
  }
  onError(error: unknown): void {
    this.errors.push(error);
  }
}

/** リフレッシュ間隔の実測が済んだ QualityGovernor */
function calibrated(): QualityGovernor {
  const g = new QualityGovernor(4);
  for (let i = 0; i < 30; i++) g.calibrate(1 / 60);
  return g;
}

function setup(governor = new QualityGovernor(4)) {
  const target = new FakeTarget();
  const client = new FakeClient();
  const loop = new FrameLoop({ target, governor, client, now: () => 0 });
  let t = 1000;
  /** ms 後の rAF を 1 回回す */
  const tick = (ms: number) => {
    t += ms;
    target.cb?.(t);
  };
  return { target, client, loop, governor, tick };
}

describe('FrameLoop', () => {
  test('リフレッシュ間隔の実測を待たずに、最初のフレームから進めて描画する', () => {
    const { target, client, loop, governor, tick } = setup();
    loop.start();
    tick(0);
    expect(governor.calibrated).toBe(false);
    expect(client.frames.length).toBe(1);
    expect(target.renders).toBe(1);
  });

  test('リフレッシュ間隔は、描画しないフレームの間隔で測る', () => {
    const { client, loop, governor, tick } = setup();
    loop.start();
    tick(0);
    // 描画したフレームの直後の間隔（描画の重さを含む）は使わない
    tick(40);
    for (let i = 0; i < 29; i++) tick(1000 / 60);
    expect(governor.calibrated).toBe(false);
    tick(1000 / 60);
    expect(governor.calibrated).toBe(true);
    expect(governor.target).toBeCloseTo(1 / 60, 9);
    expect(client.frames.length).toBe(32);
  });

  test('描画し続けていて実測が済んでいなければ、描画したフレームの間隔でも測る', () => {
    const { client, loop, governor, tick } = setup();
    client.dirty = true;
    loop.start();
    tick(0);
    for (let i = 0; i < 30; i++) tick(1000 / 60);
    expect(governor.calibrated).toBe(false);
    for (let i = 0; i < 30; i++) tick(1000 / 60);
    expect(governor.calibrated).toBe(true);
    expect(governor.target).toBeCloseTo(1 / 60, 9);
  });

  test('最初のフレームは 0、長い間隔は上限で切り、生の値も渡す', () => {
    const { client, loop, tick } = setup(calibrated());
    loop.start();
    tick(0);
    tick(16);
    tick(500);
    const [a, b, c] = client.frames;
    expect(a.rawDt).toBe(0);
    expect(a.dt).toBe(0);
    expect(b.rawDt).toBeCloseTo(0.016, 6);
    expect(c.rawDt).toBeCloseTo(0.5, 6);
    expect(c.dt).toBe(MAX_FRAME_DT);
  });

  test('必要なときだけ描画する。最初のフレームと invalidate() のあとは必ず描画する', () => {
    const { target, client, loop, tick } = setup(calibrated());
    loop.start();
    tick(0);
    expect(target.renders).toBe(1);
    tick(16);
    tick(16);
    expect(target.renders).toBe(1);
    client.dirty = true;
    tick(16);
    expect(target.renders).toBe(2);
    client.dirty = false;
    loop.invalidate();
    tick(16);
    expect(target.renders).toBe(3);
    tick(16);
    expect(target.renders).toBe(3);
  });

  test('描画したフレームの間隔で品質を判定し、段階が変わったら知らせて描画する', () => {
    const g = calibrated();
    const { target, client, loop, tick } = setup(g);
    loop.start();
    client.dirty = true;
    tick(0);
    for (let i = 0; i < 200 && client.qualityChanges.length === 0; i++) tick(50);
    expect(client.qualityChanges).toEqual([1]);
    expect(g.level).toBe(1);
    expect(target.renders).toBeGreaterThan(0);
  });

  test('描画しないフレームが遅くても、段階は変えない', () => {
    const { client, loop, tick } = setup(calibrated());
    loop.start();
    tick(0);
    for (let i = 0; i < 200; i++) tick(50);
    expect(client.qualityChanges).toEqual([]);
  });

  test('stop() で rAF を外し、以後のフレームは進めない', () => {
    const { target, client, loop, tick } = setup();
    loop.start();
    const cb = target.cb;
    loop.stop();
    expect(target.cb).toBe(null);
    cb?.(2000);
    tick(16);
    expect(client.frames.length).toBe(0);
  });

  test('フレームの処理で例外が投げられたら、ループを止めてから 1 回だけ知らせる', () => {
    const { target, client, loop, tick } = setup(calibrated());
    loop.start();
    tick(0);
    const cb = target.cb;
    const error = new Error('boom');
    client.fail = error;
    tick(16);
    expect(target.cb).toBe(null);
    expect(client.errors).toEqual([error]);
    cb?.(5000);
    expect(client.errors).toEqual([error]);
    expect(target.renders).toBe(1);
  });

  test('描画で例外が投げられても、同じように止めて知らせる', () => {
    const { target, client, loop, tick } = setup(calibrated());
    const error = new Error('render');
    target.render = () => {
      throw error;
    };
    loop.start();
    tick(0);
    expect(target.cb).toBe(null);
    expect(client.errors).toEqual([error]);
  });
});

describe('FixedStepper', () => {
  test('積み立てた時間からステップ数を返し、残りを alpha にする', () => {
    const s = new FixedStepper(1 / 120, 12);
    expect(s.advance(1 / 60)).toBe(2);
    expect(s.remainder).toBeCloseTo(0, 9);
    expect(s.advance(1 / 240)).toBe(0);
    expect(s.alpha).toBeCloseTo(0.5, 9);
    expect(s.advance(1 / 240)).toBe(1);
  });

  test('1 フレームのステップ数には上限があり、超えた遅れは捨てる', () => {
    const s = new FixedStepper(1 / 120, 12);
    expect(s.advance(1)).toBe(12);
    expect(s.remainder).toBe(0);
    expect(s.advance(1 / 120)).toBe(1);
  });

  test('30 / 60 / 120Hz のどれでも、1 秒で 120 ステップ進む', () => {
    for (const hz of [30, 60, 120]) {
      const s = new FixedStepper(1 / 120, 12);
      let n = 0;
      for (let i = 0; i < hz; i++) n += s.advance(1 / hz);
      expect(Math.abs(n - 120)).toBeLessThanOrEqual(1);
    }
  });

  test('負や NaN の dt は積み立てない', () => {
    const s = new FixedStepper(1 / 120, 12);
    expect(s.advance(-1)).toBe(0);
    expect(s.advance(Number.NaN)).toBe(0);
    expect(s.remainder).toBe(0);
  });
});
