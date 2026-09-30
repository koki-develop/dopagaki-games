import { describe, expect, test } from 'bun:test';
import { BREAKOUT_ARRANGEMENT } from './bgm.ts';

describe('BREAKOUT_ARRANGEMENT', () => {
  test('キックとベースは常に鳴らし、ハイハットは段階 1 から入る', () => {
    const level = (layer: number) => [0, 1, 2, 3, 4].map((tier) => BREAKOUT_ARRANGEMENT.layerLevel(layer, tier));
    expect(level(0)).toEqual([1, 1, 1, 1, 1]);
    expect(level(1)).toEqual([1, 1, 1, 1, 1]);
    expect(level(2)).toEqual([0, 1, 1, 1, 1]);
  });
});
