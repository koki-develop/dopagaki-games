import { pointOf } from '../rules/cards.ts';
import type { Card } from '../rules/cards.ts';
import { handValue, isPair } from '../rules/hand.ts';
import type { Action } from '../rules/round.ts';

/**
 * ベーシックストラテジー。2 組・ディーラーはソフト 17 で止まる・分けた後もダブルできる・サレンダーなしの規則で、
 * 手の合計（とペア）とディーラーの見せているカードから操作を決める表。
 * 表の値は Wizard of Odds の 2 組・S17 の composition-dependent な期待値の表（Appendix 9）の、各合計の最善の操作に合わせてある。
 * 開発用の自動操作と、規則の実装の期待値をシミュレーションで確かめるテストに使う。画面でプレイヤーに勧めることはしない。
 *
 * 表の文字: H 引く、S 止める、D ダブル（できなければ引く）、E ダブル（できなければ止める）、P 分ける。
 * 列はディーラーの見せているカードの点 2〜10、A の順
 */
type Code = 'H' | 'S' | 'D' | 'E' | 'P';

const row = (s: string): readonly Code[] => s.split('') as Code[];

/** 合計 5〜21 のハードの手（添字は合計 − 5） */
const HARD: readonly (readonly Code[])[] = [
  row('HHHHHHHHHH'), // 5
  row('HHHHHHHHHH'), // 6
  row('HHHHHHHHHH'), // 7
  row('HHHHHHHHHH'), // 8
  row('DDDDDHHHHH'), // 9
  row('DDDDDDDDHH'), // 10
  row('DDDDDDDDDD'), // 11
  row('HHSSSHHHHH'), // 12
  row('SSSSSHHHHH'), // 13
  row('SSSSSHHHHH'), // 14
  row('SSSSSHHHHH'), // 15
  row('SSSSSHHHHH'), // 16
  row('SSSSSSSSSS'), // 17
  row('SSSSSSSSSS'), // 18
  row('SSSSSSSSSS'), // 19
  row('SSSSSSSSSS'), // 20
  row('SSSSSSSSSS'), // 21
];

/** ソフト 13〜21（A,2 〜 A,10）の手（添字は合計 − 13） */
const SOFT: readonly (readonly Code[])[] = [
  row('HHHDDHHHHH'), // 13
  row('HHHDDHHHHH'), // 14
  row('HHDDDHHHHH'), // 15
  row('HHDDDHHHHH'), // 16
  row('HDDDDHHHHH'), // 17
  row('SEEEESSHHH'), // 18
  row('SSSSSSSSSS'), // 19
  row('SSSSSSSSSS'), // 20
  row('SSSSSSSSSS'), // 21
];

/** ペア（添字は点 − 1。A のペアが 0、10 点のペアが 9）。分けないときはハードかソフトの表で決める（null） */
const PAIRS: readonly (readonly ('P' | null)[])[] = [
  'PPPPPPPPPP', // A,A
  'PPPPPP----', // 2,2
  'PPPPPP----', // 3,3
  '---PP-----', // 4,4
  '----------', // 5,5
  'PPPPPP----', // 6,6
  'PPPPPPP---', // 7,7
  'PPPPPPPPPP', // 8,8
  'PPPPP-PP--', // 9,9
  '----------', // 10,10
].map((s) => s.split('').map((c) => (c === 'P' ? 'P' : null)));

/** ディーラーの見せているカードの点（1〜10）の、表の列 */
const column = (up: number): number => (up === 1 ? 9 : up - 2);

/** 選べる操作 */
export type Options = { readonly double: boolean; readonly split: boolean };

/** ベーシックストラテジーで、手 cards とディーラーの見せているカード up から選ぶ操作 */
export function basicAction(cards: readonly Card[], up: Card, can: Options): Action {
  const col = column(pointOf(up));
  if (can.split && isPair(cards) && PAIRS[pointOf(cards[0]) - 1][col] === 'P') return 'split';
  const v = handValue(cards);
  // 分けられない A,A（ソフト 12）は引く
  const code: Code = v.soft ? (v.total < 13 ? 'H' : SOFT[v.total - 13][col]) : HARD[Math.max(5, Math.min(21, v.total)) - 5][col];
  switch (code) {
    case 'H':
      return 'hit';
    case 'S':
      return 'stand';
    case 'D':
      return can.double ? 'double' : 'hit';
    case 'E':
      return can.double ? 'double' : 'stand';
    case 'P':
      return 'split';
  }
}
