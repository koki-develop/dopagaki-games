import { describe, expect, test } from 'bun:test';
import { applyResult, emptyRecords, mergeRecords, sanitizeRecords } from './records-model.ts';
import type { Records } from './records-model.ts';
import { runResult, sheetOf } from './result.test-support.ts';

const records = (over: Partial<Records>): Records => ({ ...emptyRecords(), ...over });

/** played ≥ wins + losses + draws、perfect ≤ wins */
const consistent = (r: Records): boolean => r.played >= r.wins + r.losses + r.draws && r.perfect <= r.wins;

describe('applyResult', () => {
  test('勝ち・負け・引き分けを数え、最高スコアと最大コンボを更新する', () => {
    let r = emptyRecords();
    r = applyResult(r, runResult());
    r = applyResult(r, runResult({ maxCombo: 3, score: sheetOf({ moves: 9000, discs: 50, won: true, perfect: false, maxCombo: 3 }) }));
    expect(r).toMatchObject({ played: 2, wins: 2, bestScore: 9000 + 5000 + 5000 + 600, maxCombo: 6 });
    r = applyResult(r, runResult({ outcome: 'lose', score: sheetOf({ moves: 100, discs: 10, won: false, perfect: false, maxCombo: 0 }) }));
    expect(r).toMatchObject({ played: 3, losses: 1, bestScore: 9000 + 5000 + 5000 + 600 });
    r = applyResult(r, runResult({ outcome: 'draw' }));
    expect(r.draws).toBe(1);
  });

  test('パーフェクトを数える', () => {
    expect(applyResult(emptyRecords(), runResult({ perfect: true, cpu: 0 })).perfect).toBe(1);
  });
});

describe('sanitizeRecords', () => {
  test('壊れた値とありえない値は 0 にし、辻褄の合わない値を直す', () => {
    const r = sanitizeRecords({ played: 1, wins: 3, losses: -1, perfect: 7, maxCombo: 61, bestScore: 1234.7 });
    expect(r).toEqual({ played: 3, wins: 3, losses: 0, draws: 0, perfect: 3, bestScore: 1234, maxCombo: 0 });
    expect(sanitizeRecords({})).toEqual(emptyRecords());
  });
});

describe('mergeRecords', () => {
  test('数は項目ごとに大きいほうを取る。どの順で合わせても同じ', () => {
    const a = applyResult(applyResult(emptyRecords(), runResult()), runResult());
    const b = applyResult(applyResult(applyResult(emptyRecords(), runResult()), runResult()), runResult({ outcome: 'lose' }));
    const m = mergeRecords(a, b);
    expect(m).toMatchObject({ played: 3, wins: 2, losses: 1 });
    expect(mergeRecords(b, a)).toEqual(m);
  });

  test('項目ごとに大きいほうを取っても、対局数は勝ち・負け・引き分けの合計を下回らない', () => {
    // 別々のタブで 2 局ずつ勝ちと負けを記録した
    const wins = records({ played: 2, wins: 2 });
    const losses = records({ played: 2, losses: 2 });
    const m = mergeRecords(wins, losses);
    expect(m).toMatchObject({ played: 4, wins: 2, losses: 2 });
    expect(consistent(m)).toBe(true);
    expect(mergeRecords(losses, wins)).toEqual(m);
  });

  test('パーフェクトは勝ちの数を超えない', () => {
    expect(mergeRecords(records({ played: 3, wins: 1, perfect: 3 }), records({ played: 1, wins: 1, perfect: 1 })).perfect).toBe(1);
  });
});
