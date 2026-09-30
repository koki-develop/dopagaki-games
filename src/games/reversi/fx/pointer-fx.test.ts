import { describe, expect, test } from 'bun:test';
import type { FrameTime } from '../../../juice/frame-time.ts';
import { cellX, cellY } from '../geometry.ts';
import { BLACK, WHITE } from '../rules/position.ts';
import type { Color } from '../rules/position.ts';
import { RIM_HUE } from '../view/palette.ts';
import type { PreviewFlip } from './choreo.ts';
import { createFxState } from './fx-state.ts';
import { PointerFx } from './pointer-fx.ts';

function setup(human: Color = BLACK) {
  const previews: [number, Color, number, number][] = [];
  const fx = createFxState();
  const pointer = new PointerFx(
    {
      discs: { preview: (square, color, flips, now) => void previews.push([square, color, flips.length, now]) },
      human,
    },
    fx,
  );
  const ft: FrameTime = { realDt: 0, worldDt: 0, real: 0, world: 0, present: 0 };
  /** 実時間を dt 秒ずつ frames フレーム進める */
  const run = (frames: number, dt = 1 / 60): void => {
    for (let i = 0; i < frames; i++) {
      ft.realDt = dt;
      ft.real += dt;
      pointer.update(ft, fx);
    }
  };
  return { pointer, fx, ft, previews, run };
}

const FLIPS: readonly PreviewFlip[] = [{ square: 20, dirX: 1, dirY: 0 }];

describe('PointerFx', () => {
  test('合法手と押している間の予告の色相は、人の石の縁の色', () => {
    expect(setup(BLACK).fx.markerHue).toBe(RIM_HUE[BLACK]);
    expect(setup(WHITE).fx.markerHue).toBe(RIM_HUE[WHITE]);
  });

  test('打てるマスを押すと予告を出し、マスの光を寄せる。同じマスのままなら予告を出し直さない', () => {
    const { pointer, fx, previews, run } = setup();
    pointer.setPointer(19, true, FLIPS, 5);
    pointer.setPointer(19, true, FLIPS, 6);
    expect(previews).toEqual([[19, BLACK, 1, 5]]);
    run(60);
    expect([fx.hoverX, fx.hoverY, fx.hoverLegal]).toEqual([cellX(19), cellY(19), 1]);
    expect(fx.hover).toBeGreaterThan(0.99);
  });

  test('打てないマスは予告を消し、灰色の光だけを出す。離すと光は消えていき、位置は残る', () => {
    const { pointer, fx, previews, run } = setup();
    pointer.setPointer(0, false, FLIPS, 1);
    expect(previews).toEqual([[-1, BLACK, 0, 1]]);
    run(30);
    expect(fx.hoverLegal).toBe(0);
    pointer.clearPointer(2);
    run(60);
    expect(fx.hover).toBeLessThan(0.01);
    expect([fx.hoverX, fx.hoverY]).toEqual([cellX(0), cellY(0)]);
  });

  test('キーボードのカーソルを出し、-1 で消す', () => {
    const { pointer, fx, run } = setup();
    pointer.setCursor(9);
    run(60);
    expect([fx.cursorX, fx.cursorY]).toEqual([cellX(9), cellY(9)]);
    expect(fx.cursor).toBeGreaterThan(0.99);
    pointer.setCursor(-1);
    run(60);
    expect(fx.cursor).toBeLessThan(0.01);
  });
});
