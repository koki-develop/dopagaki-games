import { POINTS } from './cards.ts';
import { BLACKJACK } from './hand.ts';
import { DECKS } from './shoe.ts';

/**
 * 確率の計算。どれも、プレイヤーから見えていないカード（シューの残りと、伏せてあるディーラーのカード）の、
 * 点の種類ごとの枚数（unseen。添字は点の種類 − 1）から、引く順に関係なく 1 枚ずつ戻さずに引くものとして求める。
 * 演出の溜めに使う。どれも決まった値を返し、乱数は使わない。
 */

/** ディーラーが引き終えた結果の数。添字 0〜4 が合計 17〜21、5 がバースト */
export const DEALER_FINALS = 6;
const BUST = 5;
/** ディーラーが引くのをやめる合計（ソフト 17 でも止まる） */
export const DEALER_STANDS = 17;

/** A を 1 と数えた合計 hard の手に unseen から 1 枚引いて、21 を超える確率。見えていないカードがなければ 0 */
export function bustChance(hard: number, unseen: ArrayLike<number>): number {
  let total = 0;
  let bust = 0;
  for (let p = 1; p <= POINTS; p++) {
    const n = unseen[p - 1];
    total += n;
    if (hard + p > BLACKJACK) bust += n;
  }
  return total > 0 ? bust / total : 0;
}

/** 見えていないカードが尽きたときに引く先の枚数（新しいシューの構成）。添字は点の種類 − 1 */
const FRESH = Int32Array.from({ length: POINTS }, (_, i) => (i === POINTS - 1 ? 16 : 4) * DECKS);

/**
 * ディーラーが引き終えた結果の確率（添字 0〜4 が合計 17〜21、5 がバースト）を out に書く。
 * hard と hasAce は、ディーラーの見えているカードの合計（A を 1 と数える）と A を含むか。
 * excludeFirst は、最初に引く 1 枚（伏せてあるカード）がありえない点（ディーラーがブラックジャックでないと確かめた後の、
 * A を見せているときの 10 点、10 点を見せているときの A）。なければ 0。
 * 見えていないカードが尽きたら、新しいシューの構成から引くものとする（シューが尽きたら捨てたカードを混ぜ直すので）。
 * 引き方の枝をすべて辿り、各枝の確率を結果へ足していく。
 */
export function dealerFinals(hard: number, hasAce: boolean, unseen: ArrayLike<number>, excludeFirst: number, out: Float64Array): Float64Array {
  out.fill(0);
  const counts = scratchCounts;
  for (let p = 0; p < POINTS; p++) counts[p] = unseen[p];
  let left = 0;
  for (let p = 0; p < POINTS; p++) left += counts[p];
  const walk = (h: number, ace: boolean, weight: number, exclude: number, remaining: number): void => {
    if (h > BLACKJACK) {
      out[BUST] += weight;
      return;
    }
    const v = ace && h + 10 <= BLACKJACK ? h + 10 : h;
    if (v >= DEALER_STANDS) {
      out[v - DEALER_STANDS] += weight;
      return;
    }
    const fresh = remaining === 0;
    const pool = fresh ? FRESH : counts;
    let total = 0;
    for (let p = 1; p <= POINTS; p++) if (p !== exclude) total += pool[p - 1];
    for (let p = 1; p <= POINTS; p++) {
      if (p === exclude) continue;
      const n = pool[p - 1];
      if (n === 0) continue;
      const w = (weight * n) / total;
      if (fresh) {
        walk(h + p, ace || p === 1, w, 0, 0);
        continue;
      }
      counts[p - 1]--;
      walk(h + p, ace || p === 1, w, 0, remaining - 1);
      counts[p - 1]++;
    }
  };
  walk(hard, hasAce, 1, excludeFirst, left);
  return out;
}

/** dealerFinals が引いたカードを数える入れ物 */
const scratchCounts = new Int32Array(POINTS);

/** ディーラーが引き終える前の、プレイヤーの手 1 つ。total は合計、settled はもう決着した手の増減（決着していなければ null） */
export type LiveHand = { readonly total: number; readonly bet: number; readonly settled: number | null };

/**
 * ディーラーが引き終えた結果の確率 finals のもとで、ラウンドの増減の合計が正になる確率（win）と負になる確率（lose）。
 * 決着した手（バースト・ブラックジャック）は settled の増減をそのまま足す
 */
export function roundOdds(hands: readonly LiveHand[], finals: Float64Array): { win: number; lose: number } {
  let win = 0;
  let lose = 0;
  for (let k = 0; k < DEALER_FINALS; k++) {
    const p = finals[k];
    if (p === 0) continue;
    let net = 0;
    for (const h of hands) {
      if (h.settled !== null) {
        net += h.settled;
        continue;
      }
      if (k === BUST) net += h.bet;
      else {
        const d = DEALER_STANDS + k;
        net += h.total > d ? h.bet : h.total < d ? -h.bet : 0;
      }
    }
    if (net > 0) win += p;
    else if (net < 0) lose += p;
  }
  return { win, lose };
}

/** 2 つに 1 つの出来事（確率 p）の結果の分からなさ（0〜1）。p が 0.5 で 1、0 か 1 で 0 */
export const uncertainty = (p: number): number => 4 * p * (1 - p);
