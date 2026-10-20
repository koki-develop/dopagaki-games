import { describe, expect, test } from 'bun:test';
import { runResult, sheetOf } from '../../games/blackjack/result.test-support.ts';
import { lifetimeSpan, sheetLines } from './summary.ts';

describe('sheetLines', () => {
  test('始めの手持ちと勝った分は必ず出し、連勝の上乗せと負けた分はあったときだけ出す', () => {
    expect(sheetLines(runResult()).map((l) => l.kind)).toEqual(['start', 'won', 'bonus', 'lost']);
    expect(sheetLines(runResult({ score: sheetOf() })).map((l) => l.kind)).toEqual(['start', 'won']);
  });
});

describe('lifetimeSpan', () => {
  test('このプレイの前の累計から、反映した後の累計まで数える', () => {
    expect(lifetimeSpan(runResult(), 400)).toEqual({ from: -250, to: 400 });
    expect(lifetimeSpan(runResult({ outcome: 'broke', score: sheetOf({ lost: 995 }) }), -1200)).toEqual({ from: -205, to: -1200 });
  });

  test('練習のプレイは記録しないので、累計を動かさない', () => {
    expect(lifetimeSpan(runResult({ practice: true }), 400)).toEqual({ from: 400, to: 400 });
  });
});
