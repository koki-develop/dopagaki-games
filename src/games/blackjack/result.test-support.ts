import type { ScoreSheet } from './scoring.ts';
import { ROUNDS, START_CHIPS } from './scoring.ts';
import type { RunResult } from './types.ts';

/** テスト用の得点の内訳。合計は始めの手持ちと増減から作る */
export const sheetOf = (over: Partial<Omit<ScoreSheet, 'total'>> = {}): ScoreSheet => {
  const s = { start: START_CHIPS, won: 0, bonus: 0, lost: 0, ...over };
  return { ...s, total: s.start + s.won + s.bonus - s.lost };
};

/** テスト用のプレイの結果。手持ちを 1,650 に増やして終え、over で項目を差し替える（内訳は差し替えた値から作り直さない） */
export const runResult = (over: Partial<RunResult> = {}): RunResult => ({
  outcome: 'profit',
  rounds: ROUNDS,
  blackjacks: 1,
  maxStreak: 3,
  score: sheetOf({ won: 1200, bonus: 250, lost: 800 }),
  previousBest: 0,
  newBest: false,
  practice: false,
  ...over,
});
