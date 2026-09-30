import { finalSheet } from './scoring.ts';
import type { FinalInput, ScoreSheet } from './scoring.ts';
import type { RunResult } from './types.ts';

/** テスト用の終局の点。over にない材料は 0 か false にする */
export const sheetOf = (over: Partial<FinalInput> = {}): ScoreSheet =>
  finalSheet({ moves: 0, quick: 0, discs: 0, won: false, perfect: false, maxCombo: 0, fullCombo: false, ...over });

/** テスト用の対局の結果。人が黒 40・白 20 で勝ち、over で項目を差し替える（得点の内訳は差し替えた値から作り直さない） */
export const runResult = (over: Partial<RunResult> = {}): RunResult => ({
  outcome: 'win',
  human: 40,
  cpu: 20,
  perfect: false,
  maxCombo: 6,
  fullCombo: false,
  quickCount: 0,
  score: sheetOf({ moves: 3000, discs: 40, won: true, maxCombo: 6 }),
  newBest: false,
  practice: false,
  ...over,
});
