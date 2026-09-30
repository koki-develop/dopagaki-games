import { describe, expect, test } from 'bun:test';
import { emptyRecords } from '../../games/reversi/records-model.ts';
import { runResult, sheetOf } from '../../games/reversi/result.test-support.ts';
import { SCORE } from '../../games/reversi/scoring.ts';
import { leadOf, recordText, sheetLines, verdictText } from './summary.ts';

describe('sheetLines', () => {
  test('勝ちは、対局中の点・石・勝ち・最大コンボの行を出す', () => {
    expect(sheetLines(runResult())).toEqual([
      { kind: 'moves', label: 'PLAY', points: 3000 },
      { kind: 'discs', label: 'DISCS 40', points: 4000 },
      { kind: 'win', label: 'WIN', points: 5000 },
      { kind: 'combo', label: 'MAX COMBO 6', points: 1200 },
    ]);
  });

  test('パーフェクトの行を出し、負けに勝ちの点の行は出さない。コンボがなければその行も出さない', () => {
    expect(sheetLines(runResult({ perfect: true, human: 64, cpu: 0, score: sheetOf({ moves: 3000, discs: 64, won: true, perfect: true, maxCombo: 6 }) })).map((l) => l.kind)).toEqual([
      'moves',
      'discs',
      'win',
      'perfect',
      'combo',
    ]);
    expect(sheetLines(runResult({ outcome: 'lose', human: 20, maxCombo: 0, score: sheetOf({ moves: 500, discs: 20, won: false, perfect: false, maxCombo: 0 }) })).map((l) => l.kind)).toEqual([
      'moves',
      'discs',
    ]);
  });

  test('早打ちは、あったときだけ対局中の点の次に行を出す', () => {
    const r = runResult({ quickCount: 12, score: sheetOf({ moves: 3000, quick: 2400, discs: 40, won: true, maxCombo: 6 }) });
    expect(sheetLines(r).map((l) => l.label)).toEqual(['PLAY', 'QUICK 12', 'DISCS 40', 'WIN', 'MAX COMBO 6']);
    expect(sheetLines(r).find((l) => l.kind === 'quick')?.points).toBe(2400);
  });

  test('フルコンボは、最大コンボの行の代わりに、数を添えずに出す', () => {
    const r = runResult({ maxCombo: 30, fullCombo: true, score: sheetOf({ moves: 3000, discs: 40, won: true, maxCombo: 30, fullCombo: true }) });
    const lines = sheetLines(r);
    expect(lines.map((l) => l.label)).toEqual(['PLAY', 'DISCS 40', 'WIN', 'FULL COMBO']);
    expect(lines.at(-1)?.points).toBe(SCORE.fullCombo);
  });

  test('行の点の合計は、得点の内訳の合計と一致する', () => {
    const full = runResult({ quickCount: 3, fullCombo: true, score: sheetOf({ moves: 900, quick: 600, discs: 40, won: true, maxCombo: 9, fullCombo: true }) });
    for (const r of [runResult(), full, runResult({ outcome: 'draw', score: sheetOf({ moves: 10, discs: 32, won: false, perfect: false, maxCombo: 2 }) })]) {
      expect(sheetLines(r).reduce((a, l) => a + l.points, 0)).toBe(r.score.total);
    }
  });
});

describe('leadOf', () => {
  test('自分の数が相手より多いか、少ないか、同じか', () => {
    expect([leadOf(35, 29), leadOf(29, 35), leadOf(32, 32)]).toEqual(['ahead', 'behind', 'even']);
  });
});

describe('recordText', () => {
  test('対局がなければそう出し、引き分けは 1 つ以上あるときだけ出す', () => {
    expect(recordText(emptyRecords())).toBe('まだ対局していません');
    expect(recordText({ ...emptyRecords(), played: 3, wins: 2, losses: 1 })).toBe('2勝 1敗');
    expect(recordText({ ...emptyRecords(), played: 4, wins: 2, losses: 1, draws: 1 })).toBe('2勝 1敗 1分');
  });
});

describe('verdictText', () => {
  test('勝敗を出し、パーフェクトは勝敗より優先する', () => {
    expect([verdictText('win', false), verdictText('lose', false), verdictText('draw', false), verdictText('win', true)]).toEqual(['WIN', 'LOSE', 'DRAW', 'PERFECT']);
  });
});
