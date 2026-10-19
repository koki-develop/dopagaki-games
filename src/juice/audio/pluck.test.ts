import { describe, expect, test } from 'bun:test';
import { karplusStrong, roomImpulse } from './pluck.ts';
import type { PluckString } from './pluck.ts';

const RATE = 48000;
const STRING: PluckString = { name: 't', t60: 1.5, brightness: 0.6, pickPosition: 0.2, seconds: 1 };

/** 自己相関がいちばん大きい周期（サンプル）から周波数を求める。端数は放物線で補う */
function pitchOf(x: Float32Array, from: number, minHz: number, maxHz: number): number {
  const n = 8192;
  const corr = (lag: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += x[from + i] * x[from + i + lag];
    return s;
  };
  let best = 0;
  let bestLag = 0;
  for (let lag = Math.floor(RATE / maxHz); lag <= Math.ceil(RATE / minHz); lag++) {
    const c = corr(lag);
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  const a = corr(bestLag - 1);
  const b = corr(bestLag);
  const c = corr(bestLag + 1);
  return RATE / (bestLag + (a - c) / (2 * (a - 2 * b + c)));
}

const rms = (x: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
};

describe('karplusStrong', () => {
  test('ベースからギターの高さまで、2 セント以内の音程で鳴る', () => {
    for (const hz of [41.2, 98, 196, 392, 659.3]) {
      const out = new Float32Array(RATE);
      karplusStrong(out, RATE, hz, STRING, 1);
      const cents = 1200 * Math.log2(pitchOf(out, 4800, hz * 0.8, hz * 1.25) / hz);
      expect(Math.abs(cents)).toBeLessThan(2);
    }
  });

  test('振幅はおよそ 1 から始まり、t60 のあたりで大きく減っている', () => {
    const out = new Float32Array(RATE * 2);
    karplusStrong(out, RATE, 110, STRING, 7);
    let peak = 0;
    for (let i = 0; i < 2000; i++) peak = Math.max(peak, Math.abs(out[i]));
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(1.0001);
    expect(rms(out, RATE * 1.5 - 4800, RATE * 1.5) / rms(out, 0, 4800)).toBeLessThan(0.01);
  });

  test('同じ種なら同じ波形', () => {
    const a = new Float32Array(1000);
    const b = new Float32Array(1000);
    karplusStrong(a, RATE, 220, STRING, 3);
    karplusStrong(b, RATE, 220, STRING, 3);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('roomImpulse', () => {
  test('左右で違う響きが、指定した長さで −60 dB へ減る', () => {
    const l = new Float32Array(RATE);
    const r = new Float32Array(RATE);
    roomImpulse([l, r], RATE, 1);
    expect(l[1000]).not.toBe(r[1000]);
    const head = rms(l, 480, 4800);
    const tail = rms(l, RATE - 4800, RATE);
    expect(20 * Math.log10(tail / head)).toBeLessThan(-45);
    expect(Math.abs(l[0])).toBe(0);
  });
});
