import { describe, expect, test } from 'bun:test';
import type { FrameTime } from '../../../juice/frame-time.ts';
import { FrameSummary } from './aggregate.ts';
import { IntensityMeter } from './intensity.ts';
import { BREAK_MIN_INTERVAL, SoundDirector } from './sound-director.ts';
import { Recorder, recordingSfx } from './test-kit.test-support.ts';

function setup() {
  const rec = new Recorder();
  const sounds = new SoundDirector(recordingSfx(rec));
  const ft: FrameTime = { realDt: 1 / 60, worldDt: 1 / 60, real: 0, world: 0, present: 0 };
  const s = new FrameSummary();
  const meter = new IntensityMeter();
  return {
    rec,
    sounds,
    ft,
    s,
    meter,
    /** dt 秒ぶん進めて 1 フレーム鳴らす */
    step(dt = 1 / 60) {
      ft.realDt = dt;
      ft.worldDt = dt;
      ft.real += dt;
      meter.update(s.breaks, s.maxChain, dt);
      sounds.frame(s, meter, ft);
    },
  };
}

describe('SoundDirector', () => {
  test('パドルの音は 0.08 秒より詰めて鳴らさず、その間の当たりを次の 1 音にまとめる', () => {
    const t = setup();
    t.s.paddleCount = 1;
    for (let i = 0; i < 60; i++) t.step();
    const calls = t.rec.of('sfx.paddle');
    expect(calls.length).toBeLessThanOrEqual(Math.ceil(1 / 0.08) + 1);
    expect(calls.length).toBeGreaterThan(8);
    // まとめた数だけ強くなる
    expect(calls[1].args[0]).toBeGreaterThan(calls[0].args[0] as number);
  });

  test('ハードの音は残り HP の割合の最小値で鳴らす（間引いている間の分も含める）', () => {
    const t = setup();
    t.s.hardCount = 1;
    t.s.hardMinRatio = 0.5;
    t.step();
    t.s.hardMinRatio = 0.25;
    t.step();
    t.s.hardMinRatio = 0.75;
    t.step();
    t.step();
    const calls = t.rec.of('sfx.hardHit');
    expect(calls[0].args[0]).toBe(0.5);
    expect(calls[1].args[0]).toBe(0.25);
    expect(calls[1].args[1]).toBe(3);
  });

  test('壊れないブロックの音は 0.06 秒より詰めて鳴らさず、その間の当たりを次の 1 音にまとめる', () => {
    const t = setup();
    t.s.solidCount = 2;
    for (let i = 0; i < 60; i++) t.step();
    const calls = t.rec.of('sfx.solidHit');
    expect(calls.length).toBeLessThanOrEqual(Math.ceil(1 / 0.06) + 1);
    expect(calls.length).toBeGreaterThan(8);
    expect(calls[0].args[0]).toBe(2);
    // 間引いている間の当たりも数える
    expect(calls[1].args[0]).toBeGreaterThan(2);
    t.s.solidCount = 0;
    const n = calls.length;
    for (let i = 0; i < 30; i++) t.step();
    expect(t.rec.of('sfx.solidHit').length).toBe(n);
  });

  test('ボール大量ブロックの音は 1 フレームに 1 回', () => {
    const t = setup();
    t.s.megaCount = 3;
    t.s.megaChain = 4;
    t.step();
    expect(t.rec.of('sfx.megaBurst').map((c) => c.args)).toEqual([[3]]);
  });

  test('破壊音は壊れたフレームでだけ鳴らし、0.04 秒より詰めない。破壊が止まったら次のフレームから鳴らない', () => {
    const t = setup();
    t.s.breaks = 5;
    t.s.maxChain = 1;
    let lastAt = -Infinity;
    for (let i = 0; i < 60; i++) {
      t.s.maxChain += 5;
      const before = t.rec.count('sfx.breakNote');
      t.step();
      if (t.rec.count('sfx.breakNote') === before) continue;
      expect(t.ft.real - lastAt).toBeGreaterThanOrEqual(BREAK_MIN_INTERVAL);
      lastAt = t.ft.real;
    }
    const notes = t.rec.of('sfx.breakNote');
    expect(notes.length).toBeGreaterThan(15);
    expect(notes.length).toBeLessThanOrEqual(Math.ceil(1 / BREAK_MIN_INTERVAL) + 1);
    // 間引いた破壊は次の 1 音にまとめる。最後の 1 音の後に壊れた分だけが残る
    const merged = notes.reduce((sum, c) => sum + (c.args[1] as number), 0);
    expect(merged).toBeLessThanOrEqual(300);
    expect(merged).toBeGreaterThan(300 - 5 * Math.ceil(BREAK_MIN_INTERVAL * 60));
    t.s.breaks = 0;
    for (let i = 0; i < 60; i++) t.step();
    expect(t.rec.count('sfx.breakNote')).toBe(notes.length);
  });

  test('最短間隔の途中で途切れた破壊は、後から鳴らさない', () => {
    const t = setup();
    t.s.maxChain = 1;
    t.s.breaks = 1;
    t.step();
    t.step();
    expect(t.rec.count('sfx.breakNote')).toBe(1);
    t.s.breaks = 0;
    for (let i = 0; i < 10; i++) t.step();
    expect(t.rec.count('sfx.breakNote')).toBe(1);
    // 次に壊れたときも、途切れた分をまとめない
    t.s.breaks = 1;
    t.step();
    expect(t.rec.of('sfx.breakNote').map((c) => c.args[1])).toEqual([1, 1]);
  });

  test('音程は 1 音ごとに 1 つ上がり、chain より先へは進まない。chain が切れたら戻る', () => {
    const t = setup();
    // ゆっくり壊すと、音程は chain と同じ高さ
    t.s.breaks = 1;
    for (let chain = 1; chain <= 4; chain++) {
      t.s.maxChain = chain;
      t.step(0.1);
    }
    expect(t.rec.of('sfx.breakNote').map((c) => c.args[0])).toEqual([0, 1, 2, 3]);
    // 速く壊すと、chain が先へ進んでも 1 音に 1 つずつ上がる
    t.s.breaks = 8;
    for (let i = 0; i < 30; i++) {
      t.s.maxChain += 8;
      t.step();
    }
    const fast = t.rec.of('sfx.breakNote').slice(4).map((c) => c.args[0] as number);
    expect(fast.length).toBeGreaterThan(5);
    for (let k = 0; k < fast.length; k++) expect(fast[k]).toBe(4 + k);
    // chain が切れると、新しい chain の高さへ戻る
    t.s.breaks = 1;
    t.s.maxChain = 1;
    t.step(0.1);
    expect(t.rec.of('sfx.breakNote').at(-1)!.args[0]).toBe(0);
  });

  test('破壊ペースが上がるほど、1 音を小さくする', () => {
    const t = setup();
    t.s.maxChain = 1;
    t.s.breaks = 1;
    t.step(0.5);
    const calm = t.rec.of('sfx.breakNote').at(-1)!.args[3] as number;
    t.s.breaks = 8;
    for (let i = 0; i < 60; i++) t.step();
    const busy = t.rec.of('sfx.breakNote').at(-1)!.args[3] as number;
    expect(calm).toBeLessThanOrEqual(1);
    expect(busy).toBeLessThan(calm);
    expect(busy).toBeGreaterThanOrEqual(0.5);
  });

  test('quiesce の後は何も鳴らさない', () => {
    const t = setup();
    t.s.breaks = 5;
    t.s.paddleCount = 2;
    t.s.hardCount = 2;
    t.s.solidCount = 2;
    t.s.megaCount = 1;
    for (let i = 0; i < 30; i++) t.step();
    t.sounds.quiesce();
    const n = t.rec.calls.length;
    for (let i = 0; i < 600; i++) t.step();
    expect(t.rec.calls.length).toBe(n);
  });

  test('フィナーレで砕ける音は、砕けたフレームでだけ鳴らし、0.05 秒より詰めずにまとめる', () => {
    const t = setup();
    t.sounds.quiesce();
    for (let i = 0; i < 60; i++) {
      t.ft.real += 1 / 60;
      t.sounds.shatter(2, t.ft);
    }
    const calls = t.rec.of('sfx.solidShatter');
    expect(calls.length).toBeLessThanOrEqual(Math.ceil(1 / 0.05) + 1);
    expect(calls.length).toBeGreaterThan(10);
    expect(calls[0].args[0]).toBe(2);
    expect(calls[1].args[0]).toBeGreaterThan(2);
    for (let i = 0; i < 30; i++) {
      t.ft.real += 1 / 60;
      t.sounds.shatter(0, t.ft);
    }
    expect(t.rec.of('sfx.solidShatter').length).toBe(calls.length);
  });

  test('フィナーレの届く音は間引いてまとめ、音程は届いた数の合計で進む', () => {
    const t = setup();
    let collected = 0;
    for (let i = 0; i < 60; i++) {
      t.ft.real += 1 / 60;
      collected += 3;
      t.sounds.bonus(3, collected, t.ft);
    }
    const calls = t.rec.of('sfx.bonusNote');
    expect(calls.length).toBeLessThanOrEqual(Math.ceil(1 / 0.04) + 1);
    expect(calls.length).toBeGreaterThan(10);
    for (const c of calls) {
      expect(c.args[0] as number).toBeLessThan(40);
      expect(c.args[1] as number).toBeLessThanOrEqual(1.1);
    }
  });
});
