import { describe, expect, test } from 'bun:test';
import { EVENT_KIND_COUNT, EventKind, EventQueue, Signal } from './events.ts';
import { Rng } from './rng.ts';

describe('EventQueue', () => {
  test('容量を超えた分は積まないが、件数は数え続ける', () => {
    const q = new EventQueue(4);
    for (let i = 0; i < 10; i++) q.push(EventKind.BlockBreak, i, i * 2, 1, i);
    q.push(EventKind.WallHit, 0, 0, -1, 0);
    expect(q.length).toBe(4);
    expect(q.counts[EventKind.BlockBreak]).toBe(10);
    expect(q.counts[EventKind.WallHit]).toBe(1);
    expect(Array.from(q.x.subarray(0, 4))).toEqual([0, 1, 2, 3]);
    q.clear();
    expect(q.length).toBe(0);
    expect(Array.from(q.counts)).toEqual(new Array(EVENT_KIND_COUNT).fill(0));
  });

  test('信号はビットで溜まり、位置を伴う信号だけが位置を書く', () => {
    const q = new EventQueue(4);
    q.signal(Signal.BallsZero);
    expect(q.signalX).toBe(0);
    q.signalAt(Signal.StageClear, 3, 7);
    q.signal(Signal.LifeLost);
    expect(q.signals).toBe(Signal.BallsZero | Signal.StageClear | Signal.LifeLost);
    expect(q.signalX).toBe(3);
    expect(q.signalY).toBe(7);
    q.clear();
    expect(q.signals).toBe(0);
  });

  test('種類と信号の値は重ならない', () => {
    const kinds = Object.values(EventKind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(Math.max(...kinds)).toBe(EVENT_KIND_COUNT - 1);
    const bits = Object.values(Signal);
    for (const b of bits) expect(b & (b - 1)).toBe(0);
    expect(new Set(bits).size).toBe(bits.length);
  });
});

describe('Rng', () => {
  test('同じシードなら同じ列を返す（既知の列）', () => {
    const r = new Rng(1);
    const seq = Array.from({ length: 6 }, () => r.nextUint32());
    expect(seq).toEqual([473542192, 3964317691, 2295682031, 2113742504, 3256742822, 2257891190]);
    const a = new Rng(0xdeadbeef);
    const b = new Rng(0xdeadbeef);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  test('next は [0, 1) に収まる', () => {
    const r = new Rng(42);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
