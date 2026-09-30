import { describe, expect, test } from 'bun:test';
import { BOARD_FRAME, cellX, cellY, computeLayout, squareAt, toPxX, toPxY } from './geometry.ts';
import { parseSquare } from './rules/position.ts';

describe('computeLayout', () => {
  test('縦長の画面では幅に合わせ、上下の余白の間の中央に置く', () => {
    const l = computeLayout(390, 844, 100, 80);
    expect(l.pxPerUnit).toBeCloseTo((390 - 20) / (8 + BOARD_FRAME * 2), 9);
    const boardTop = toPxY(l, 8);
    const boardBottom = toPxY(l, 0);
    expect(boardTop - 100).toBeCloseTo(844 - 80 - boardBottom, 6);
    expect(toPxX(l, 4)).toBeCloseTo(195, 9);
  });

  test('横長の画面では高さに合わせる', () => {
    const l = computeLayout(1280, 720, 60, 60);
    expect(l.pxPerUnit).toBeCloseTo(600 / (8 + BOARD_FRAME * 2), 9);
  });

  test('カメラの範囲は画面全体を覆う', () => {
    const l = computeLayout(320, 568, 90, 70);
    expect((l.right - l.left) * l.pxPerUnit).toBeCloseTo(320, 6);
    expect((l.top - l.bottom) * l.pxPerUnit).toBeCloseTo(568, 6);
    expect(toPxX(l, l.left)).toBeCloseTo(0, 6);
    expect(toPxY(l, l.top)).toBeCloseTo(0, 6);
  });

  test('幅 320px でも、1 マスは WCAG 2.2 の 2.5.8 の最小（24 × 24 CSS ピクセル）より大きい', () => {
    expect(computeLayout(320, 568, 110, 80).pxPerUnit).toBeGreaterThan(24);
  });
});

describe('squareAt', () => {
  test('マスの中心の位置からそのマスを返し、盤の外は -1', () => {
    const l = computeLayout(390, 844, 100, 80);
    for (const name of ['a1', 'h1', 'a8', 'h8', 'd4', 'e5']) {
      const s = parseSquare(name);
      expect(squareAt(l, toPxX(l, cellX(s)), toPxY(l, cellY(s)))).toBe(s);
    }
    expect(squareAt(l, toPxX(l, -0.1), toPxY(l, 4))).toBe(-1);
    expect(squareAt(l, toPxX(l, 4), toPxY(l, 8.01))).toBe(-1);
  });
});
