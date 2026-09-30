import { describe, expect, test } from 'bun:test';
import { AudioEngine } from '../../../juice/audio/engine.ts';
import { MockAudioContext } from '../../../juice/audio/mock-audio.test-support.ts';
import type { IntervalTimer } from '../../../juice/audio/sequencer.ts';
import { BREAKOUT_ARRANGEMENT, createBreakoutBgm } from './bgm.ts';

class FakeTimer implements IntervalTimer {
  fn: (() => void) | null = null;
  set(fn: () => void): unknown {
    this.fn = fn;
    return 1;
  }
  clear(): void {
    this.fn = null;
  }
}

describe('BREAKOUT_ARRANGEMENT', () => {
  test('キックとベースは常に鳴らし、ハイハットは段階 1、パッドは段階 4 から入る', () => {
    const level = (layer: number) => [0, 1, 2, 3, 4].map((tier) => BREAKOUT_ARRANGEMENT.layerLevel(layer, tier));
    expect(level(0)).toEqual([1, 1, 1, 1, 1]);
    expect(level(1)).toEqual([1, 1, 1, 1, 1]);
    expect(level(2)).toEqual([0, 1, 1, 1, 1]);
    expect(level(3)).toEqual([0, 0, 0, 0, 1]);
  });

  test('パッドのノコギリ波は 1 つのエンベロープを共有する', () => {
    const ctx = new MockAudioContext();
    const engine = new AudioEngine(() => ctx.asContext());
    engine.unlock();
    const timer = new FakeTimer();
    const bgm = createBreakoutBgm(engine, timer);
    bgm.setTier(4);
    const before = ctx.sources.length;
    bgm.start();
    ctx.currentTime = 0.03;
    timer.fn?.();
    const saws = ctx.sources.slice(before).filter((s) => s.type === 'sawtooth' && s.outputs[0] !== undefined);
    const padSaws = saws.filter((s) => s.detune.value === 11 || s.detune.value === -11);
    expect(padSaws.length).toBe(10);
    expect(new Set(padSaws.map((s) => s.outputs[0])).size).toBe(1);
  });
});
