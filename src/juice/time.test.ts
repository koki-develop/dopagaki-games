import { describe, expect, test } from 'bun:test';
import { WorldClock } from './time.ts';

describe('WorldClock', () => {
  test('ヒットストップの間は世界時間が進まず、フレームの途中で終わったら残りの分だけ進む', () => {
    const c = new WorldClock();
    c.hitStop(0.1);
    expect(c.advance(0.05)).toBe(0);
    expect(c.advance(0.08)).toBeCloseTo(0.03, 9);
    expect(c.advance(0.02)).toBeCloseTo(0.02, 9);
    c.hitStop(0);
    expect(c.advance(0.02)).toBeCloseTo(0.02, 9);
  });

  test('止めている間のヒットストップは、遅く終わるほうまで止める。短いものでは縮まない', () => {
    const c = new WorldClock();
    c.hitStop(0.2);
    expect(c.advance(0.05)).toBe(0);
    c.hitStop(0.05);
    expect(c.advance(0.1)).toBeCloseTo(0, 9);
    c.hitStop(0.2);
    expect(c.advance(0.25)).toBeCloseTo(0.05, 9);
  });

  test('フレームの長さが違っても、ヒットストップで止まる長さは同じ', () => {
    const run = (dt: number) => {
      const c = new WorldClock();
      c.hitStop(0.2);
      let world = 0;
      for (let t = 0; t < 0.5 - 1e-9; t += dt) world += c.advance(dt);
      return world;
    };
    expect(run(1 / 60)).toBeCloseTo(0.3, 6);
    expect(run(1 / 30)).toBeCloseTo(0.3, 6);
    expect(run(1 / 144)).toBeCloseTo(0.3, 6);
  });

  test('スローモーションは hold の間その倍率で、release の間に等速へ戻る', () => {
    const c = new WorldClock();
    c.slowMo(0.2, 0.5, 0.5);
    const first = c.advance(0.1);
    expect(first).toBeCloseTo(0.02, 9);
    for (let i = 0; i < 20; i++) c.advance(0.05);
    expect(c.advance(0.1)).toBeCloseTo(0.1, 9);
  });

  test('スローモーションが無ければ実時間と同じだけ進み、スローモーションは呼んだ時点の実時間から始まる', () => {
    const c = new WorldClock();
    expect(c.advance(0.5)).toBeCloseTo(0.5, 9);
    c.slowMo(0.5, 10, 0);
    expect(c.advance(0.5)).toBeCloseTo(0.25, 9);
  });

  test('重なったスローモーションは一番遅い倍率に従い、それぞれの長さが過ぎたら外れる', () => {
    const c = new WorldClock();
    c.slowMo(0.5, 1, 0);
    c.slowMo(0.1, 0.2, 0);
    expect(c.advance(0.1)).toBeCloseTo(0.01, 9);
    c.advance(0.2);
    expect(c.advance(0.1)).toBeCloseTo(0.05, 9);
    c.advance(1);
    expect(c.advance(0.1)).toBeCloseTo(0.1, 9);
  });

  test('slowMoWorld は倍率を保つ長さを世界時間で数える', () => {
    const c = new WorldClock();
    c.slowMoWorld(0.25, 0.1, 0);
    let world = 0;
    // 実時間では 0.4 秒保つ
    for (let i = 0; i < 4; i++) world += c.advance(0.1);
    expect(world).toBeCloseTo(0.1, 9);
    expect(c.advance(0.1)).toBeCloseTo(0.1, 9);
  });

  test('slowMoWorld の倍率が 0 なら戻さない', () => {
    const c = new WorldClock();
    c.slowMoWorld(0, 0.1, 0.5);
    for (let i = 0; i < 50; i++) expect(c.advance(0.1)).toBe(0);
  });

  test('release が Infinity なら戻さない', () => {
    const c = new WorldClock();
    c.slowMo(0.1, 0.2, Infinity);
    for (let i = 0; i < 100; i++) c.advance(0.1);
    expect(c.advance(0.1)).toBeCloseTo(0.01, 9);
  });

  test('release が 0 なら、hold が終わったらすぐ等速に戻す', () => {
    const c = new WorldClock();
    c.slowMo(0.5, 0.2, 0);
    expect(c.advance(0.1)).toBeCloseTo(0.05, 9);
    expect(c.advance(0.1)).toBeCloseTo(0.05, 9);
    expect(c.advance(0.1)).toBeCloseTo(0.1, 9);
  });
});
