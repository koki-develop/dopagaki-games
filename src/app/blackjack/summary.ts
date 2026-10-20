import { runNet } from '../../games/blackjack/records-model.ts';
import type { Outcome, RunResult } from '../../games/blackjack/types.ts';

const OUTCOME_TEXT: Readonly<Record<Outcome, string>> = { profit: 'PROFIT', even: 'EVEN', loss: 'LOSS', broke: 'BROKE' };

/** 決着の文字（結果画面の見出しと、終わりの儀式の決着） */
export const verdictText = (outcome: Outcome): string => OUTCOME_TEXT[outcome];

/** 得点の内訳の 1 行。kind ごとに名前の文字の色を変える（styles.css の .bj-sheet li[data-kind]）。sign は点の前に付ける符号 */
export type SheetLine = { kind: 'start' | 'won' | 'bonus' | 'lost'; label: string; points: number; sign: '' | '+' | '-' };

/** 結果画面の得点の内訳の行。始めの手持ちと勝った分は必ず出し、連勝の上乗せと負けた分はあったときだけ出す */
export function sheetLines(r: RunResult): SheetLine[] {
  const s = r.score;
  const lines: SheetLine[] = [
    { kind: 'start', label: 'START', points: s.start, sign: '' },
    { kind: 'won', label: 'WIN', points: s.won, sign: '+' },
  ];
  if (s.bonus > 0) lines.push({ kind: 'bonus', label: 'STREAK BONUS', points: s.bonus, sign: '+' });
  if (s.lost > 0) lines.push({ kind: 'lost', label: 'LOSS', points: s.lost, sign: '-' });
  return lines;
}

/** 増減の符号。増減と累計の数の色を変える（styles.css の [data-sign]） */
export const signOf = (n: number): 'plus' | 'minus' | 'zero' => (n > 0 ? 'plus' : n < 0 ? 'minus' : 'zero');

/** 結果画面の累計の欄が数える範囲。from はこのプレイの前の累計、to は今の累計 */
export type LifetimeSpan = { from: number; to: number };

/**
 * 結果画面の累計の欄が数える範囲。lifetime は記録の今の累計で、このプレイの結果はもう反映してある。
 * 練習のプレイは記録しないので、累計は動かさない
 */
export function lifetimeSpan(r: RunResult, lifetime: number): LifetimeSpan {
  return { from: r.practice ? lifetime : lifetime - runNet(r), to: lifetime };
}
