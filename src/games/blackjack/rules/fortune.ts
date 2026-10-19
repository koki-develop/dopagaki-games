import type { Rng } from '../../../shared/rng.ts';
import { pointOf } from './cards.ts';
import type { Card } from './cards.ts';
import { BLACKJACK, totalOf } from './hand.ts';
import { DEALER_STANDS } from './odds.ts';
import type { Shoe } from './shoe.ts';

/**
 * プレイヤーへのさりげない幸運の強さ。どれも「次に配るカードがプレイヤーにとって痛いとき、その確率で、すぐ後ろ lookahead 枚のうち
 * 痛くない最初のカードと入れ替える」確率。
 * - bust: プレイヤーが選んで引いた 1 枚（引く・ダブル）でバーストする
 * - dealerNatural: ディーラーの伏せたカードで、ディーラーがブラックジャックになる
 * - dealerWin: ディーラーが引いた 1 枚で止まり（17〜21）、比べる手のどれにも勝つ
 */
export type FortuneTuning = {
  readonly lookahead: number;
  readonly bust: number;
  readonly dealerNatural: number;
  readonly dealerWin: number;
};

/**
 * 値は、ベーシックストラテジーで毎回同じ額を賭けたときに、勝つラウンド（約 43.5%）と負けるラウンド（約 48%）の割合が
 * ほぼ入れ替わるように決めてある（fortune.test.ts のシミュレーションで確かめる）。
 * バーストもディーラーのブラックジャックも、ふつうに起き続ける強さにとどめる
 */
export const FORTUNE: FortuneTuning = { lookahead: 6, bust: 0.15, dealerNatural: 0.2, dealerWin: 0.1 };

/**
 * プレイヤーに少しだけ有利なカードの配り方。シューの順を、配る直前に、すぐ後ろのカードとの入れ替えで少しだけ変える。
 * 残りのカードの構成は変えないので、見えていないカードから求める確率（溜めの長さ）はそのまま正しい。
 * 入れ替えはプレイヤーの得になるときだけで、損になる入れ替え（ニアミスを作るなど）はしない。
 * シューが尽きかけて、すぐ後ろに入れ替えるカードがないときは何もしない（混ぜ直しをまたがない）
 */
export class Fortune {
  private readonly rng: Rng;
  private readonly t: FortuneTuning;

  constructor(rng: Rng, tuning: FortuneTuning = FORTUNE) {
    this.rng = rng;
    this.t = tuning;
  }

  /** プレイヤーの手 hand に、選んで 1 枚引く前に呼ぶ */
  beforePlayerDraw(shoe: Shoe, hand: readonly Card[]): void {
    this.soften(shoe, this.t.bust, (c) => totalWith(hand, c) > BLACKJACK);
  }

  /** ディーラーの伏せたカード（表のカードは up）を配る前に呼ぶ */
  beforeHoleCard(shoe: Shoe, up: Card): void {
    const upPoint = pointOf(up);
    if (upPoint !== 1 && upPoint !== 10) return;
    this.soften(shoe, this.t.dealerNatural, (c) => (upPoint === 1 ? pointOf(c) === 10 : pointOf(c) === 1));
  }

  /** ディーラーが 1 枚引く前に呼ぶ。target は、比べる手（止めた手）のうちいちばん大きい合計 */
  beforeDealerDraw(shoe: Shoe, dealer: readonly Card[], target: number): void {
    this.soften(shoe, this.t.dealerWin, (c) => {
      const total = totalWith(dealer, c);
      return total >= DEALER_STANDS && total <= BLACKJACK && total > target;
    });
  }

  /** 次のカードが痛ければ（hurts）、chance の確率で、すぐ後ろの痛くないカードと入れ替える */
  private soften(shoe: Shoe, chance: number, hurts: (c: Card) => boolean): void {
    const next = shoe.peek(0);
    if (next < 0 || !hurts(next) || this.rng.next() >= chance) return;
    for (let k = 1; k <= this.t.lookahead; k++) {
      const c = shoe.peek(k);
      if (c < 0) return;
      if (!hurts(c)) {
        shoe.swapNext(k);
        return;
      }
    }
  }
}

/** cards に c を足した合計 */
function totalWith(cards: readonly Card[], c: Card): number {
  return totalOf([...cards, c]);
}
