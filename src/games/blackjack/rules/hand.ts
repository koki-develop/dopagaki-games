import { pointOf } from './cards.ts';
import type { Card } from './cards.ts';

/** 21 を超えたらバースト */
export const BLACKJACK = 21;

/** 手の合計。soft は A を 11 として数えている（もう 1 枚引いても 21 を超えることがない）か */
export type HandValue = { readonly total: number; readonly soft: boolean };

/** A をすべて 1 と数えた合計 */
export function hardTotal(cards: readonly Card[]): number {
  let t = 0;
  for (const c of cards) t += pointOf(c);
  return t;
}

/** 点の合計 hard（A をすべて 1 と数えた合計）と、A を含むかから決まる手の合計 */
export function valueOf(hard: number, hasAce: boolean): HandValue {
  if (hasAce && hard + 10 <= BLACKJACK) return { total: hard + 10, soft: true };
  return { total: hard, soft: false };
}

/** 手の合計。A は 21 を超えない限り 1 枚を 11 と数える */
export function handValue(cards: readonly Card[]): HandValue {
  return valueOf(hardTotal(cards), cards.some((c) => pointOf(c) === 1));
}

/** 手の合計の数（21 を超えたらそのまま） */
export const totalOf = (cards: readonly Card[]): number => handValue(cards).total;

export const isBust = (cards: readonly Card[]): boolean => hardTotal(cards) > BLACKJACK;

/** 最初の 2 枚で 21（A と 10 点のカード）。分けた手の 21 はブラックジャックではない */
export const isNatural = (cards: readonly Card[]): boolean => cards.length === 2 && totalOf(cards) === BLACKJACK;

/** 2 枚が同じ点（10 と K も同じ点として分けられる） */
export const isPair = (cards: readonly Card[]): boolean => cards.length === 2 && pointOf(cards[0]) === pointOf(cards[1]);
