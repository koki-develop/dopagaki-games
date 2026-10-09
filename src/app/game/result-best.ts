import { formatScore } from '../../shared/format.ts';

/**
 * 結果画面の最高スコアの欄。更新したら NEW BEST!（new）、更新しなかったら前の最高スコア（previous）を出す。
 * 前の最高スコアが 0（記録がない）で更新もしていなければ、何も出さない（none）
 */
export type ResultBest = { k: 'new' } | { k: 'previous'; score: number } | { k: 'none' };

export function resultBestOf(newBest: boolean, previousBest: number): ResultBest {
  if (newBest) return { k: 'new' };
  return previousBest > 0 ? { k: 'previous', score: previousBest } : { k: 'none' };
}

/** 最高スコアの欄の読み上げ。出さないときは空 */
export function resultBestText(best: ResultBest): string {
  switch (best.k) {
    case 'new':
      return '最高スコアを更新しました。';
    case 'previous':
      return `ベスト ${formatScore(best.score)}。`;
    case 'none':
      return '';
  }
}
