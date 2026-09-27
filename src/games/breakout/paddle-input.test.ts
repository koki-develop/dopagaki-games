import { describe, expect, test } from 'bun:test';
import { STEP_HZ, snapshotTuning } from './config.ts';
import { PaddleInput } from './paddle-input.ts';
import { paddleRange, Sim } from './sim/sim.ts';
import type { SimInput } from './sim/sim.ts';

const collect = (input: PaddleInput, n: number): SimInput[] => {
  const out: SimInput[] = [];
  input.feed(n, (i) => out.push({ ...i }));
  return out;
};

describe('PaddleInput', () => {
  test('目標位置は範囲に収め、有限でない値は無視する', () => {
    const p = new PaddleInput(1, 8, 4.5);
    p.moveBy(10);
    expect(p.target).toBe(8);
    p.moveTo(-3);
    expect(p.target).toBe(1);
    p.moveBy(Number.NaN);
    p.moveTo(Number.POSITIVE_INFINITY);
    expect(p.target).toBe(1);
  });

  test('1 フレームの n ステップへ、前に渡した位置から今の目標まで等分して渡す', () => {
    const p = new PaddleInput(0, 9, 4);
    p.moveTo(6);
    expect(collect(p, 4).map((i) => i.paddleTargetX)).toEqual([4.5, 5, 5.5, 6]);
    p.moveTo(5);
    expect(collect(p, 2).map((i) => i.paddleTargetX)).toEqual([5.5, 5]);
  });

  test('ステップが進まないフレームの動きは、次に進むフレームへ持ち越す', () => {
    const p = new PaddleInput(0, 9, 4);
    p.moveTo(5);
    expect(collect(p, 0)).toEqual([]);
    p.moveTo(6);
    expect(collect(p, 2).map((i) => i.paddleTargetX)).toEqual([5, 6]);
  });

  test('発射の合図は次に進むステップの最初の 1 回にだけ渡す', () => {
    const p = new PaddleInput(0, 9, 4);
    p.latchLaunch();
    expect(collect(p, 0)).toEqual([]);
    expect(collect(p, 3).map((i) => i.launch)).toEqual([true, false, false]);
    expect(collect(p, 2).map((i) => i.launch)).toEqual([false, false]);
  });

  test('同じ速さで動かしながら発射すると、フレームレートが違っても同じ向きに飛ぶ', () => {
    const config = snapshotTuning();
    const launchDirection = (fps: number): [number, number] => {
      const sim = new Sim({ mode: { kind: 'endless' }, seed: 7, config });
      const { min, max } = paddleRange(config);
      const input = new PaddleInput(min, max, sim.paddleX);
      const stepsPerFrame = STEP_HZ / fps;
      const step = (i: SimInput) => sim.step(i);
      // 3 u/s で右へ動かし、0.5 秒後に離す
      for (let frame = 0; frame < fps / 2; frame++) {
        input.moveBy(3 / fps);
        input.feed(stepsPerFrame, step);
      }
      input.latchLaunch();
      input.moveBy(3 / fps);
      input.feed(stepsPerFrame, step);
      expect(sim.attached).toBe(false);
      return [sim.balls.dx[0], sim.balls.dy[0]];
    };
    const at120 = launchDirection(120);
    expect(Math.abs(at120[0])).toBeGreaterThan(0.05);
    for (const fps of [30, 60]) {
      const d = launchDirection(fps);
      expect(d[0]).toBeCloseTo(at120[0], 9);
      expect(d[1]).toBeCloseTo(at120[1], 9);
    }
  });
});
