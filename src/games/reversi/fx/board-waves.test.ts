import { describe, expect, test } from 'bun:test';
import { RIPPLE, SHOCKWAVE } from '../config.ts';
import { BoardWaves } from './board-waves.ts';
import { createFxState } from './fx-state.ts';

const starts = (slots: Float32Array): number[] => Array.from({ length: slots.length / 4 }, (_, i) => slots[i * 4 + 2]);

describe('BoardWaves', () => {
  test('衝撃波は枠を順に使い、枠が埋まるまで前の衝撃波を消さない。埋まったら古いものから上書きする', () => {
    const fx = createFxState();
    const w = new BoardWaves(fx);
    for (let i = 0; i < SHOCKWAVE.slots; i++) w.shockwave(i, 4, 4, 10 + i);
    expect(starts(fx.shockwaves)).toEqual(Array.from({ length: SHOCKWAVE.slots }, (_, i) => i));
    w.shockwave(99, 1, 2, 7);
    expect(Array.from(fx.shockwaves.subarray(0, 4))).toEqual([1, 2, 99, 7]);
  });

  test('波紋も同じように枠を順に使う', () => {
    const fx = createFxState();
    const w = new BoardWaves(fx);
    for (let i = 0; i <= RIPPLE.slots; i++) w.ripple(i, 0, 0, 1);
    expect(starts(fx.ripples)[0]).toBe(RIPPLE.slots);
    expect(starts(fx.ripples)[1]).toBe(1);
  });
});
