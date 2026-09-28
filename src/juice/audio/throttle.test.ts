import { describe, expect, test } from 'bun:test';
import { SoundThrottle } from './throttle.ts';

const DT = 1 / 60;

function setup() {
  const throttle = new SoundThrottle({ minInterval: 0.05, rateTau: 0.5, halfGainRate: 10, minGain: 0.3 });
  let now = 0;
  return {
    throttle,
    /** 1 フレーム進めて hits 回起きたことを渡し、update() の戻り値を返す */
    frame(hits: number): number {
      now += DT;
      return throttle.update(now, DT, hits);
    },
  };
}

describe('SoundThrottle', () => {
  test('最短間隔をあけて鳴らし、その間に起きた分を次の 1 音にまとめる', () => {
    const t = setup();
    const out: number[] = [];
    for (let i = 0; i < 7; i++) out.push(t.frame(2));
    // 0.05 秒は 3 フレーム
    expect(out).toEqual([2, 0, 0, 6, 0, 0, 6]);
  });

  test('起きなかったフレームでは鳴らさない', () => {
    const t = setup();
    expect(t.frame(1)).toBe(1);
    expect(t.frame(1)).toBe(0);
    for (let i = 0; i < 10; i++) expect(t.frame(0)).toBe(0);
  });

  test('次が来ないまま最短間隔が過ぎたら、まとめていた分を捨てる', () => {
    const t = setup();
    t.frame(1);
    t.frame(3);
    t.frame(0);
    t.frame(0);
    expect(t.frame(1)).toBe(1);
  });

  test('最短間隔の中で次が来たら、まとめていた分を足して鳴らす', () => {
    const t = setup();
    t.frame(1);
    t.frame(3);
    t.frame(0);
    expect(t.frame(1)).toBe(4);
  });

  test('頻度が高いほど 1 音を小さくし、下限より小さくはしない', () => {
    const t = setup();
    t.frame(1);
    const calm = t.throttle.gain;
    for (let i = 0; i < 60; i++) t.frame(1);
    const busy = t.throttle.gain;
    expect(busy).toBeLessThan(calm);
    for (let i = 0; i < 120; i++) t.frame(50);
    expect(t.throttle.gain).toBe(0.3);
  });
});
