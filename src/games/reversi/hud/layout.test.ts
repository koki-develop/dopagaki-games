import { describe, expect, test } from 'bun:test';
import { computeHudLayout, sameHudLayout } from './layout.ts';

describe('computeHudLayout', () => {
  test('HUD の下端までと、手番の表示の上端から下の高さを、描画領域を基準に返す', () => {
    const l = computeHudLayout({ left: 0, top: 10, width: 390, height: 800 }, { left: 0, top: 10, width: 390, height: 70 }, { left: 0, top: 740, width: 390, height: 40 });
    expect(l).toEqual({ top: 70, bottom: 70 });
  });

  test('負の値にはならない', () => {
    expect(computeHudLayout({ left: 0, top: 100, width: 1, height: 1 }, { left: 0, top: 0, width: 1, height: 50 }, { left: 0, top: 500, width: 1, height: 1 })).toEqual({ top: 0, bottom: 0 });
  });

  test('同じ配置かどうか', () => {
    expect(sameHudLayout(null, { top: 1, bottom: 2 })).toBe(false);
    expect(sameHudLayout({ top: 1, bottom: 2 }, { top: 1, bottom: 2 })).toBe(true);
    expect(sameHudLayout({ top: 1, bottom: 2 }, { top: 1, bottom: 3 })).toBe(false);
  });
});
