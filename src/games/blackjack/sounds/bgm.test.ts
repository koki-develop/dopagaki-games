import { describe, expect, test } from 'bun:test';
import type { StepVoice } from '../../../juice/audio/bgm.ts';
import { AudioEngine } from '../../../juice/audio/engine.ts';
import type { Voice } from '../../../juice/audio/engine.ts';
import { MockAudioContext } from '../../../juice/audio/mock-audio.test-support.ts';
import type { MockSource } from '../../../juice/audio/mock-audio.test-support.ts';
import { BLACKJACK_ARRANGEMENT as A } from './bgm.ts';

const BASS = 0;
const DRUMS = 1;
const KEYS = 2;
const STEPS_PER_BAR = A.stepsPerBeat * 4;
const LOOP_BARS = 16;

/** 1 小節で、層ごとに鳴らすステップ（小節の中の位置） */
function barPattern(bar: number): number[][] {
  const out: number[][] = [[], [], []];
  for (let inBar = 0; inBar < STEPS_PER_BAR; inBar++) {
    const voice: StepVoice = (_duration, _gain, layer) => {
      if (!out[layer].includes(inBar)) out[layer].push(inBar);
      return null;
    };
    A.play(bar * STEPS_PER_BAR + inBar, 0, 0, voice);
  }
  return out;
}

describe('BLACKJACK_ARRANGEMENT', () => {
  test('段階によらず、どの層もずっと同じ音量で鳴らし、効果音の後ろに控えるよう全体を絞る', () => {
    const level = A.layerLevel(0, 0);
    expect(level).toBeLessThan(0.5);
    for (let layer = 0; layer < A.layerCount; layer++) for (const tier of [0, 1, 2, 3, 4]) expect(A.layerLevel(layer, tier)).toBe(level);
  });

  test('ベース・ドラム・ローズの 3 つの層で、16 分の刻みで、ベースは「1、2 拍目の裏、3、4 拍目の裏」、ドラムは毎刻み', () => {
    expect(A.layerCount).toBe(3);
    expect(A.stepsPerBeat).toBe(4);
    for (let bar = 0; bar < LOOP_BARS; bar++) {
      const p = barPattern(bar);
      expect(p[BASS]).toEqual([0, 6, 8, 14]);
      expect(p[DRUMS]).toHaveLength(STEPS_PER_BAR);
    }
  });

  test('ローズは和音の変わり目ごとに和音を鳴らし、16 小節の 1 周目だけその上で旋律を弾く。2 周で元に戻る', () => {
    const keys = (bar: number) => barPattern(bar)[KEYS];
    expect(keys(0)).toEqual([0, 4, 6, 8]);
    expect(keys(LOOP_BARS)).toEqual([0]);
    // 和音が 2 つの小節（4 小節目）は、頭と 3 拍目
    expect(keys(LOOP_BARS + 3)).toEqual([0, 8]);
    expect(keys(LOOP_BARS * 2)).toEqual(keys(0));
  });

  test('部屋の響きへは、ベースを少なく、ローズを多く送る', () => {
    const room = A.room;
    if (!room) throw new Error('room is missing');
    expect(room.sends).toHaveLength(A.layerCount);
    expect(room.sends[BASS]).toBeLessThan(room.sends[DRUMS]);
    expect(room.sends[DRUMS]).toBeLessThan(room.sends[KEYS]);
  });

  test('どの音も、可聴域の周波数で鳴り、確保した枠の長さのうちに止まる', () => {
    const ctx = new MockAudioContext();
    const engine = new AudioEngine(() => ctx.asContext());
    engine.unlock();
    const group = engine.createGroup();
    const voices: Voice[] = [];
    for (let step = 0; step < STEPS_PER_BAR * LOOP_BARS * 2; step++) {
      ctx.currentTime = step * 0.12;
      A.play(step, ctx.currentTime, 0, (duration, gain) => {
        const v = engine.voice({ bus: 'bgm', duration, gain, when: 0, priority: 'normal', group });
        if (v) voices.push(v);
        return v;
      });
    }
    expect(ctx.sources.length).toBeGreaterThan(0);
    for (const v of voices) for (const src of v.sources as unknown as MockSource[]) expect(src.stopAt).toBeLessThanOrEqual(v.end + 1e-9);
    for (const src of ctx.sources) {
      if (src.kind !== 'oscillator') continue;
      for (const e of src.frequency.events) {
        if (e.kind === 'cancel') continue;
        expect(e.value).toBeGreaterThan(0);
        expect(e.value).toBeLessThan(20000);
      }
    }
  });
});
