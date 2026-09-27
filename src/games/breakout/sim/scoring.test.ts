import { describe, expect, test } from 'bun:test';
import { BlockType, sanitizeTuning, tuning } from '../config.ts';
import { Scoring } from './scoring.ts';

const cfg = sanitizeTuning(tuning).score;

describe('chain', () => {
  test('前回の破壊からちょうど chainWindow 秒なら続き、それを過ぎると切れる', () => {
    const s = new Scoring(cfg);
    expect(s.onBreak(1, BlockType.Ball, 1)).toBe(1);
    expect(s.onBreak(1 + cfg.chainWindow, BlockType.Ball, 1)).toBe(2);
    s.decay(1 + 2 * cfg.chainWindow);
    expect(s.chain).toBe(2);
    s.decay(1 + 2 * cfg.chainWindow + 1 / 120);
    expect(s.chain).toBe(0);
    expect(s.onBreak(1 + 2 * cfg.chainWindow + 1 / 120, BlockType.Ball, 1)).toBe(1);
  });

  test('プレイの開始直後（sim 時刻 0）の最初の破壊は chain 1 から始まる', () => {
    const s = new Scoring(cfg);
    s.decay(0);
    expect(s.chain).toBe(0);
    expect(s.onBreak(0, BlockType.Ball, 1)).toBe(1);
  });

  test('間が空くと 1 から数え直す', () => {
    const s = new Scoring(cfg);
    s.onBreak(0, BlockType.Ball, 1);
    s.onBreak(0.1, BlockType.Ball, 1);
    expect(s.onBreak(0.1 + cfg.chainWindow + 1 / 120, BlockType.Ball, 1)).toBe(1);
  });

  test('倍率は 1 + chain / 20 で、chain 80 で上限の ×5 に届き、それ以上は上がらない', () => {
    const s = new Scoring(cfg);
    for (let i = 0; i < 80; i++) s.onBreak(i * 0.01, BlockType.Ball, 1);
    expect(s.chain).toBe(80);
    expect(s.multiplier).toBe(cfg.chainMultMax);
    s.onBreak(0.8, BlockType.Ball, 1);
    expect(s.multiplier).toBe(cfg.chainMultMax);
    s.chain = 79;
    expect(s.multiplier).toBeCloseTo(1 + 79 / cfg.chainDivisor, 12);
  });
});

describe('得点', () => {
  test('基礎点はボール入り 10、ハード 10 × 最大 HP、ボール大量 50', () => {
    const s = new Scoring(cfg);
    expect(s.basePoints(BlockType.Ball, 1)).toBe(10);
    expect(s.basePoints(BlockType.Hard, 7)).toBe(70);
    expect(s.basePoints(BlockType.Mega, 1)).toBe(50);
  });

  test('破壊の得点は基礎点 × chain 倍率を丸めたもの', () => {
    const s = new Scoring(cfg);
    s.onBreak(0, BlockType.Hard, 3);
    expect(s.score).toBe(Math.round(30 * (1 + 1 / 20)));
  });

  test('上限を超えたボールは chain 倍率がかかり、ボールボーナスはかからない', () => {
    const s = new Scoring(cfg);
    for (let i = 0; i < 40; i++) s.onBreak(i * 0.01, BlockType.Ball, 1);
    const mult = s.multiplier;
    expect(mult).toBeCloseTo(3, 12);
    let before = s.score;
    s.onOverflow();
    expect(s.score - before).toBe(Math.round(cfg.pointsOverflow * mult));
    s.startClearBonus(4);
    before = s.score;
    expect(s.creditClearBonus(3)).toBe(3);
    expect(s.score - before).toBe(3 * cfg.pointsClearBall);
    expect(s.clearBonusRemaining).toBe(1);
  });
});
