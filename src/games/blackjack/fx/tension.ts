import { pointOf, POINTS } from '../rules/cards.ts';
import type { Card } from '../rules/cards.ts';
import { hardTotal, totalOf } from '../rules/hand.ts';
import { bustChance, DEALER_FINALS, dealerFinals, roundOdds, uncertainty } from '../rules/odds.ts';
import type { LiveHand } from '../rules/odds.ts';
import { DEALER } from '../rules/round.ts';
import type { RoundEvent } from '../rules/round.ts';

/** 見ている手 1 つ */
type SeenHand = { cards: Card[]; bet: number; settled: number | null };

/**
 * ラウンドの出来事を、プレイヤーから見えた順に追い、次のカードの結果の分からなさ（0〜1）を測る。演出の溜めの長さに使う。
 * 見えていないカード（シューの残りと、伏せたままのディーラーのカード）の点ごとの枚数を数え、確率は rules/odds.ts で求める。
 *
 * - プレイヤーが選んで引く 1 枚（引く・ダブル）: バーストするか
 * - ディーラーの伏せたカードと、ディーラーが引く 1 枚: ラウンドの増減の合計が正になるか
 *   （決着していない手が残っていないとき、確かめてディーラーのブラックジャックと分かった後は 0）
 * - それ以外のカード（最初の 4 枚、分けた手の 2 枚目）と、ディーラーの確かめ: 0
 *
 * 1 ラウンドごとに作る。
 */
export class TensionMeter {
  /** 見えていないカードの点ごとの枚数（添字は点の種類 − 1） */
  private readonly unseen = new Int32Array(POINTS);
  private readonly hands: SeenHand[] = [{ cards: [], bet: 0, settled: null }];
  private readonly dealer: Card[] = [];
  private hole: Card = -1;
  private holeShown = false;
  private peeked = false;
  /** ディーラーのブラックジャックを確かめて、ラウンドの決着がもう分かっている */
  private decided = false;
  private readonly finals = new Float64Array(DEALER_FINALS);

  /** shoe は配る前のシューの、点ごとの枚数。bet は最初の手の賭け */
  constructor(shoe: ArrayLike<number>, bet: number) {
    for (let p = 0; p < POINTS; p++) this.unseen[p] = shoe[p];
    this.hands[0].bet = bet;
  }

  /** 出来事 e を見る。返すのは、e のカードが表になる前の分からなさ（カードのない出来事は 0） */
  see(e: RoundEvent): number {
    switch (e.t) {
      case 'deal': {
        if (e.hand === DEALER) {
          const tension = this.holeShown ? this.dealerTension(this.dealer) : 0;
          if (e.faceUp) {
            this.dealer.push(e.card);
            this.remove(e.card);
          } else {
            this.hole = e.card;
            this.dealer.push(e.card);
          }
          return tension;
        }
        const h = this.hands[e.hand];
        const tension = e.chosen ? uncertainty(bustChance(hardTotal(h.cards), this.unseen)) : 0;
        h.cards.push(e.card);
        this.remove(e.card);
        return tension;
      }
      case 'reshuffle':
        for (let p = 0; p < POINTS; p++) this.unseen[p] = e.remaining[p];
        if (this.hole >= 0 && !this.holeShown) this.unseen[pointOf(this.hole) - 1]++;
        return 0;
      case 'peek':
        // 確かめは溜めない（ブラックジャックでなければ何も起きないので）。確かめた事実だけを、伏せたカードの確率に使う
        this.peeked = true;
        if (e.blackjack) this.decided = true;
        return 0;
      case 'reveal': {
        const tension = this.dealerTension(this.dealer.slice(0, 1));
        this.holeShown = true;
        this.remove(e.card);
        return tension;
      }
      case 'split': {
        const h = this.hands[e.hand];
        const second = h.cards.pop() as Card;
        this.hands.splice(e.hand + 1, 0, { cards: [second], bet: h.bet, settled: null });
        return 0;
      }
      case 'double':
        this.hands[e.hand].bet *= 2;
        return 0;
      case 'settle':
        this.hands[e.hand].settled = e.delta;
        return 0;
      default:
        return 0;
    }
  }

  private remove(card: Card): void {
    const i = pointOf(card) - 1;
    if (this.unseen[i] > 0) this.unseen[i]--;
  }

  /** ディーラーの見えているカードが cards のとき、次の 1 枚から先でラウンドに勝つかの分からなさ */
  private dealerTension(cards: readonly Card[]): number {
    if (this.decided || this.hands.every((h) => h.settled !== null)) return 0;
    const up = pointOf(this.dealer[0]);
    const first = !this.holeShown;
    const exclude = first && this.peeked ? (up === 1 ? 10 : 1) : 0;
    dealerFinals(hardTotal(cards), cards.some((c) => pointOf(c) === 1), this.unseen, exclude, this.finals);
    const live: LiveHand[] = this.hands.map((h) => ({ total: totalOf(h.cards), bet: h.bet, settled: h.settled }));
    return uncertainty(roundOdds(live, this.finals).win);
  }
}
