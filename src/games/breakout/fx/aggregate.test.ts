import { describe, expect, test } from 'bun:test';
import { BlockType } from '../config.ts';
import { EventKind, EventQueue, Signal } from '../sim/events.ts';
import {
  FrameSummary,
  FX_LIST_CAPACITY,
  FxFlag,
  MAX_BREAK_FX,
  MAX_DEBRIS_FX,
  MAX_HARD_FX,
  MAX_OVERFLOW_FX,
  MAX_SOLID_FX,
  MAX_WALL_FX,
  summarize,
} from './aggregate.ts';

function flagged(s: FrameSummary, flag: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < s.length; k++) if (s.flags[k] & flag) out.push(s.index[k]);
  return out;
}

describe('summarize', () => {
  test('破壊は全体から均等に間引き、破片はその先頭から上限まで', () => {
    const ev = new EventQueue(1024);
    for (let i = 0; i < 200; i++) ev.push(EventKind.BlockBreak, i * 0.01, 5, BlockType.Ball, i + 1);
    const s = summarize(ev, 1, new FrameSummary());
    const breaks = flagged(s, FxFlag.Break);
    expect(breaks.length).toBe(MAX_BREAK_FX);
    expect(breaks[0]).toBe(0);
    // 間隔は 200 / 48 ≒ 4.17 で、最後の方まで届いている
    for (let k = 1; k < breaks.length; k++) expect(breaks[k] - breaks[k - 1]).toBeGreaterThanOrEqual(4);
    expect(breaks[breaks.length - 1]).toBeGreaterThan(190);
    expect(flagged(s, FxFlag.Debris)).toEqual(breaks.slice(0, MAX_DEBRIS_FX));
    expect(s.breaks).toBe(200);
    expect(s.maxChain).toBe(200);
  });

  test('品質の倍率で上限を縮める', () => {
    const ev = new EventQueue(1024);
    for (let i = 0; i < 200; i++) ev.push(EventKind.BlockBreak, 1, 5, BlockType.Ball, 1);
    for (let i = 0; i < 40; i++) ev.push(EventKind.HardHit, 1, 5, 1, 4);
    for (let i = 0; i < 40; i++) ev.push(EventKind.SolidHit, 1, 5, 0, -1);
    const s = summarize(ev, 0.5, new FrameSummary());
    expect(flagged(s, FxFlag.Break).length).toBe(Math.ceil(MAX_BREAK_FX * 0.5));
    expect(flagged(s, FxFlag.Debris).length).toBe(Math.ceil(MAX_DEBRIS_FX * 0.5));
    expect(flagged(s, FxFlag.HardSpark).length).toBe(MAX_HARD_FX * 0.5);
    expect(flagged(s, FxFlag.SolidSpark).length).toBe(MAX_SOLID_FX * 0.5);
  });

  test('少ない破壊は間引かない', () => {
    const ev = new EventQueue(64);
    for (let i = 0; i < 5; i++) ev.push(EventKind.BlockBreak, 1, 5, BlockType.Ball, 1);
    const s = summarize(ev, 1, new FrameSummary());
    expect(flagged(s, FxFlag.Break)).toEqual([0, 1, 2, 3, 4]);
  });

  test('ボール大量ブロックは全部数え、弾ける演出は 3 個まで。音程は最初の 1 個の chain', () => {
    const ev = new EventQueue(64);
    for (let i = 0; i < 5; i++) ev.push(EventKind.BlockBreak, 1, 5, BlockType.Mega, 10 + i);
    const s = summarize(ev, 1, new FrameSummary());
    expect(s.megaCount).toBe(5);
    expect(s.megaChain).toBe(10);
    expect(flagged(s, FxFlag.Mega)).toEqual([0, 1, 2]);
  });

  test('ハードは残り HP の割合の最小値と、あふれた分も含めた数', () => {
    const ev = new EventQueue(4);
    ev.push(EventKind.HardHit, 1, 5, 3, 4);
    ev.push(EventKind.HardHit, 1, 5, 1, 4);
    ev.push(EventKind.HardHit, 1, 5, 2, 4);
    ev.push(EventKind.HardHit, 1, 5, 2, 4);
    ev.push(EventKind.HardHit, 1, 5, 0, 4);
    const s = summarize(ev, 1, new FrameSummary());
    expect(s.hardCount).toBe(5);
    expect(s.hardMinRatio).toBe(0.25);
  });

  test('壊れないブロックは、あふれた分も含めて数え、火花は先に起きたものから上限まで', () => {
    const ev = new EventQueue(MAX_SOLID_FX + 4);
    for (let i = 0; i < MAX_SOLID_FX + 10; i++) ev.push(EventKind.SolidHit, 1, 5, 0, -1);
    const s = summarize(ev, 1, new FrameSummary());
    expect(s.solidCount).toBe(MAX_SOLID_FX + 10);
    expect(flagged(s, FxFlag.SolidSpark)).toEqual(Array.from({ length: MAX_SOLID_FX }, (_, i) => i));
  });

  test('パドルの火花は打ち出しも数えて 4 個まで。位置は最後に当たったもの', () => {
    const ev = new EventQueue(64);
    ev.push(EventKind.Launch, 4, 2, 0, 0);
    for (let i = 0; i < 5; i++) ev.push(EventKind.PaddleHit, 4, 2, i * 0.1, 0);
    const s = summarize(ev, 1, new FrameSummary());
    expect(s.paddleCount).toBe(6);
    expect(s.paddleT).toBeCloseTo(0.4, 6);
    expect(flagged(s, FxFlag.PaddleSpark)).toEqual([1, 2, 3]);
  });

  test('壁は左右だけを 2 件まで。天井は揺らさない', () => {
    const ev = new EventQueue(64);
    ev.push(EventKind.WallHit, 4, 16, 0, 1);
    for (let i = 0; i < 4; i++) ev.push(EventKind.WallHit, 0, 5, -1, 0);
    const s = summarize(ev, 1, new FrameSummary());
    expect(flagged(s, FxFlag.Wall)).toEqual([1, 2]);
    expect(flagged(s, FxFlag.Wall).length).toBe(MAX_WALL_FX);
    expect(s.wallCount).toBe(5);
  });

  test('上限を超えたボールの光は 24 本まで', () => {
    const ev = new EventQueue(64);
    for (let i = 0; i < 30; i++) ev.push(EventKind.Overflow, 4, 5, 0, 0);
    const s = summarize(ev, 1, new FrameSummary());
    expect(flagged(s, FxFlag.Overflow).length).toBe(MAX_OVERFLOW_FX);
  });

  test('ステージクリアの位置は StageClear が立っているときだけ読む', () => {
    const ev = new EventQueue(8);
    ev.signalAt(Signal.PenaltyLanded, 3, 7);
    const s = summarize(ev, 1, new FrameSummary());
    expect([s.clearX, s.clearY]).toEqual([0, 0]);
    ev.signalAt(Signal.StageClear, 2, 9);
    summarize(ev, 1, s);
    expect(s.signals & Signal.StageClear).toBeTruthy();
    expect([s.clearX, s.clearY]).toEqual([2, 9]);
  });

  test('使い回しても前のフレームの値を残さない。一覧は容量を超えない', () => {
    const ev = new EventQueue(8192);
    for (let i = 0; i < 2000; i++) ev.push((i % 8) as EventKind, 1, 5, i % 4, 3);
    const s = summarize(ev, 1, new FrameSummary());
    expect(s.length).toBeLessThanOrEqual(FX_LIST_CAPACITY);
    ev.clear();
    summarize(ev, 1, s);
    expect([s.length, s.breaks, s.maxChain, s.megaCount, s.hardCount, s.hardMinRatio, s.solidCount, s.paddleCount, s.wallCount, s.signals]).toEqual([
      0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
    ]);
  });

  test('イベント列を変えない', () => {
    const ev = new EventQueue(8);
    ev.push(EventKind.BlockBreak, 1, 2, BlockType.Ball, 1);
    ev.signal(Signal.BallsZero);
    summarize(ev, 1, new FrameSummary());
    expect(ev.length).toBe(1);
    expect(ev.signals).toBe(Signal.BallsZero);
  });
});
