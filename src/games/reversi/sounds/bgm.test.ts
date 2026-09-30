import { describe, expect, test } from 'bun:test';
import type { StepVoice } from '../../../juice/audio/bgm.ts';
import { BGM_TOP_TIER, bgmTier, REVERSI_ARRANGEMENT } from './bgm.ts';

/** 層の番号（bgm.ts の並び） */
const KICK = 0;
const BASS = 1;
const HAT = 2;
const ARP = 3;

/** 1 小節（16 ステップ）で、段階 tier のときに層ごとに鳴らすステップ（小節の中の位置） */
function barPattern(tier: number, bar = 0): number[][] {
  const out: number[][] = [[], [], [], []];
  for (let inBar = 0; inBar < 16; inBar++) {
    const voice: StepVoice = (_duration, _gain, layer) => {
      if (!out[layer].includes(inBar)) out[layer].push(inBar);
      return null;
    };
    REVERSI_ARRANGEMENT.play(bar * 16 + inBar, 0, tier, voice);
  }
  return out;
}

describe('bgmTier', () => {
  test('盤に置かれた石が 12・24・40 個で段階が上がり、いちばん上の段階で止まる', () => {
    expect([0, 4, 11, 12, 23, 24, 39, 40, 64].map(bgmTier)).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3]);
    expect(bgmTier(64)).toBe(BGM_TOP_TIER);
  });
});

describe('REVERSI_ARRANGEMENT', () => {
  test('キックとベースは常に鳴らし、ハイハットは段階 1、アルペジオは段階 2 から入る', () => {
    const level = (layer: number) => [0, 1, 2, 3].map((tier) => REVERSI_ARRANGEMENT.layerLevel(layer, tier));
    expect(level(KICK)).toEqual([1, 1, 1, 1]);
    expect(level(BASS)).toEqual([1, 1, 1, 1]);
    expect(level(HAT)).toEqual([0, 1, 1, 1]);
    expect(level(ARP)).toEqual([0, 0, 1, 1]);
  });

  test('キックは 4 分、ハイハットは裏の 16 分、アルペジオは 8 分で刻む', () => {
    const p = barPattern(0);
    expect(p[KICK]).toEqual([0, 4, 8, 12]);
    expect(p[HAT]).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
    expect(p[ARP]).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  test('ベースは段階 2 までは小節に 3 回、段階 3 からは 8 分で刻む', () => {
    for (const tier of [0, 1, 2]) expect(barPattern(tier)[BASS]).toEqual([0, 6, 10]);
    expect(barPattern(3)[BASS]).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });
});
