import type { Records } from '../../games/reversi/records-model.ts';
import type { Outcome, RunResult } from '../../games/reversi/types.ts';

const OUTCOME_TEXT = { win: 'WIN', lose: 'LOSE', draw: 'DRAW' } as const;

/** 石の数で相手より多いか（ahead）、少ないか（behind）、同じか（even） */
export type Lead = 'ahead' | 'behind' | 'even';

/** 自分の数 mine が、相手の数 theirs より多いか。多い側を大きく明るく、少ない側を小さく暗く見せるのに使う */
export const leadOf = (mine: number, theirs: number): Lead => (mine > theirs ? 'ahead' : mine < theirs ? 'behind' : 'even');

/** 決着の文字（結果画面の見出しと、終局の儀式の決着）。パーフェクトは勝敗より優先する */
export const verdictText = (outcome: Outcome, perfect: boolean): string => (perfect ? 'PERFECT' : OUTCOME_TEXT[outcome]);

/** 得点の内訳の 1 行。kind ごとに名前の文字の色を変える（styles.css の .rv-sheet li[data-kind]） */
export type SheetLine = { kind: 'moves' | 'quick' | 'discs' | 'win' | 'perfect' | 'combo' | 'fullCombo'; label: string; points: number };

/** 結果画面の得点の内訳の行。名前は「名前 数」の形にそろえる。対局中の点（PLAY）と石の点（DISCS）は必ず出し、当てはまらない点（負けの勝ちの点など）の行は出さない */
export function sheetLines(r: RunResult): SheetLine[] {
  const s = r.score;
  const lines: SheetLine[] = [
    { kind: 'moves', label: 'PLAY', points: s.moves },
  ];
  if (s.quick > 0) lines.push({ kind: 'quick', label: `QUICK ${r.quickCount}`, points: s.quick });
  lines.push({ kind: 'discs', label: `DISCS ${r.human}`, points: s.discPoints });
  if (s.win > 0) lines.push({ kind: 'win', label: 'WIN', points: s.win });
  if (s.perfect > 0) lines.push({ kind: 'perfect', label: 'PERFECT', points: s.perfect });
  // フルコンボは最大コンボの最上位として、最大コンボの行の代わりに出す
  if (r.fullCombo) lines.push({ kind: 'fullCombo', label: 'FULL COMBO', points: s.comboPoints });
  else if (s.comboPoints > 0) lines.push({ kind: 'combo', label: `MAX COMBO ${r.maxCombo}`, points: s.comboPoints });
  return lines;
}

/** タイトルに出す勝敗の記録。引き分けは 1 つ以上あるときだけ出す */
export function recordText(r: Records): string {
  if (r.played === 0) return 'まだ対局していません';
  const draws = r.draws > 0 ? ` ${r.draws}分` : '';
  return `${r.wins}勝 ${r.losses}敗${draws}`;
}
