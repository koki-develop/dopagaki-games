import { describe, expect, test } from 'bun:test';
import type { FrameTime } from '../frame-time.ts';
import { FrameSummary } from './aggregate.ts';
import { IntensityMeter, WATERFALL_ENTER } from './intensity.ts';
import { SoundDirector, WATERFALL_LOOKAHEAD, WATERFALL_NOTES_PER_SEC } from './sound-director.ts';
import { Recorder, recordingSfx } from './test-kit.test-support.ts';

function setup() {
  const rec = new Recorder();
  let audioTime = 10;
  const sounds = new SoundDirector(recordingSfx(rec), () => audioTime);
  const ft: FrameTime = { realDt: 1 / 60, worldDt: 1 / 60, real: 0, world: 0, present: 0 };
  const s = new FrameSummary();
  const meter = new IntensityMeter();
  return {
    rec,
    sounds,
    ft,
    s,
    meter,
    /** dt 秒ぶん進めて 1 フレーム鳴らす。audioDt は AudioContext の時刻の進み */
    step(dt = 1 / 60, audioDt = dt) {
      ft.realDt = dt;
      ft.worldDt = dt;
      ft.real += dt;
      audioTime += audioDt;
      meter.update(s.breaks, s.maxChain, dt);
      sounds.frame(s, meter, ft);
    },
    get audioTime() {
      return audioTime;
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

  test('ボール大量ブロックの音は 1 フレームに 1 回', () => {
    const t = setup();
    t.s.megaCount = 3;
    t.s.megaChain = 4;
    t.step();
    expect(t.rec.of('sfx.megaBurst').map((c) => c.args)).toEqual([[3]]);
  });

  test('破壊ペースが低いうちは 1 フレームに 1 音、高いと音の滝を先の時刻まで予約する', () => {
    const t = setup();
    t.s.breaks = 1;
    t.s.maxChain = 3;
    t.step();
    expect(t.rec.of('sfx.breakNote').map((c) => c.args[0])).toEqual([2]);
    t.s.breaks = 5;
    for (let i = 0; i < 30; i++) t.step();
    expect(t.meter.rate).toBeGreaterThan(WATERFALL_ENTER);
    const notes = t.rec.of('sfx.waterfallNote');
    expect(notes.length).toBeGreaterThan(5);
    for (let k = 1; k < notes.length; k++) {
      expect(notes[k].args[1] as number).toBeCloseTo((notes[k - 1].args[1] as number) + 1 / WATERFALL_NOTES_PER_SEC, 9);
      expect(notes[k].args[0]).toBe((notes[k - 1].args[0] as number) + 1);
    }
    const last = notes[notes.length - 1].args[1] as number;
    expect(last).toBeLessThan(t.audioTime + WATERFALL_LOOKAHEAD);
  });

  test('長いフレームでは 1.5 フレームぶん先まで予約し、止まっていた分は過去に並べない', () => {
    const t = setup();
    t.s.breaks = 5;
    for (let i = 0; i < 30; i++) t.step();
    const before = t.rec.count('sfx.waterfallNote');
    // 0.5 秒止まってから、長いフレーム
    t.step(0.1, 0.6);
    const fresh = t.rec.of('sfx.waterfallNote').slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    for (const c of fresh) expect(c.args[1] as number).toBeGreaterThanOrEqual(t.audioTime);
    const last = fresh[fresh.length - 1].args[1] as number;
    expect(last).toBeGreaterThanOrEqual(t.audioTime + 0.15 - 1 / WATERFALL_NOTES_PER_SEC);
    expect(last).toBeLessThan(t.audioTime + 0.15);
  });

  test('quiesce の後は何も鳴らさない', () => {
    const t = setup();
    t.s.breaks = 5;
    t.s.paddleCount = 2;
    t.s.hardCount = 2;
    t.s.megaCount = 1;
    for (let i = 0; i < 30; i++) t.step();
    t.sounds.quiesce();
    const n = t.rec.calls.length;
    for (let i = 0; i < 600; i++) t.step();
    expect(t.rec.calls.length).toBe(n);
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
