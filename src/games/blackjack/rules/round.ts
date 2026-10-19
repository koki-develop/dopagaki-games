import { pointOf } from './cards.ts';
import type { Card } from './cards.ts';
import { BLACKJACK, isBust, isNatural, isPair, totalOf } from './hand.ts';
import { DEALER_STANDS } from './odds.ts';
import type { Fortune } from './fortune.ts';
import type { Shoe } from './shoe.ts';

/** 1 ラウンドで持てる手の数の上限（分けて 4 つまで） */
export const MAX_HANDS = 4;

/** プレイヤーの選ぶ操作 */
export type Action = 'hit' | 'stand' | 'double' | 'split';
export const ACTIONS: readonly Action[] = ['hit', 'stand', 'double', 'split'];

/**
 * 手の状態。
 * - playing: まだ操作できる（分けた直後で 1 枚しかない手を含む）
 * - stood: 止めた（21 になった手、A を分けた手、ダブルして 1 枚引いた手を含む）。ディーラーと比べる
 * - bust: 21 を超えた。その場で負けが決まる
 * - natural: 最初の 2 枚でブラックジャック。その場で勝ちが決まる
 */
export type HandStatus = 'playing' | 'stood' | 'bust' | 'natural';

/** 手の決着。blackjack は 3:2 で払う勝ち */
export type HandResult = 'win' | 'lose' | 'push' | 'blackjack';

/** プレイヤーの手 1 つ */
export type PlayerHand = {
  readonly cards: Card[];
  /** 賭けているチップ（ダブルすると倍） */
  bet: number;
  /** 分けてできた手（21 になってもブラックジャックにしない） */
  readonly fromSplit: boolean;
  /** A を分けた手（1 枚だけ引いて止める） */
  readonly splitAces: boolean;
  doubled: boolean;
  status: HandStatus;
  /** 決着。決まるまでは null */
  result: HandResult | null;
  /** 決着したチップの増減（賭けたチップを除く。負けは −bet） */
  delta: number;
};

/**
 * ラウンドの出来事。ラウンドの進行（規則）は操作の時点でその場で決まり、出来事を起きた順に events へ積む。
 * 演出は、この列を時間をかけて見せる。
 *
 * - deal: カードを配った。プレイヤーの手 hand か、ディーラー（hand は -1）。faceUp が false なら伏せて配った。
 *   chosen は、プレイヤーが引くかダブルを選んで配った 1 枚か
 * - reshuffle: シューが尽きたので、捨てたカードを混ぜ直した。remaining は混ぜ直したシューの点ごとの枚数（この後の deal の 1 枚を含む）
 * - peek: ディーラーが A か 10 点のカードを見せていて、伏せたカードでブラックジャックかを確かめた
 * - reveal: ディーラーの伏せたカードを表にした
 * - split: 手 hand を 2 つに分けた。2 枚目のカードは新しい手 hand + 1 になり、それより後ろの手は 1 つずつ後ろへずれる
 * - double: 手 hand の賭けを倍にした（この後 1 枚だけ配る）
 * - turn: 手 hand の操作を待つ
 * - stand: 手 hand を止めた。auto は、21 になった・A を分けた・ダブルしたので、操作なしに止めた
 * - bust: 手 hand が 21 を超えた
 * - natural: 手 hand がブラックジャック
 * - dealerNatural: ディーラーがブラックジャック
 * - dealerStand / dealerBust: ディーラーが引き終えた
 * - settle: 手 hand の決着。delta はチップの増減（賭けたチップを除く）
 * - end: ラウンドが終わった
 */
export type RoundEvent =
  | { readonly t: 'deal'; readonly hand: number; readonly card: Card; readonly faceUp: boolean; readonly chosen: boolean }
  | { readonly t: 'reshuffle'; readonly remaining: Readonly<Int32Array> }
  | { readonly t: 'peek'; readonly blackjack: boolean }
  | { readonly t: 'reveal'; readonly card: Card }
  | { readonly t: 'split'; readonly hand: number }
  | { readonly t: 'double'; readonly hand: number }
  | { readonly t: 'turn'; readonly hand: number }
  | { readonly t: 'stand'; readonly hand: number; readonly total: number; readonly auto: boolean }
  | { readonly t: 'bust'; readonly hand: number; readonly total: number }
  | { readonly t: 'natural'; readonly hand: number }
  | { readonly t: 'dealerNatural' }
  | { readonly t: 'dealerStand'; readonly total: number }
  | { readonly t: 'dealerBust'; readonly total: number }
  | { readonly t: 'settle'; readonly hand: number; readonly result: HandResult; readonly delta: number }
  | { readonly t: 'end' };

/** ディーラーの手（hand に -1） */
export const DEALER = -1;

/**
 * 1 ラウンドの進行。ディーラーは 1 人、プレイヤーの手は最初 1 つで、分けて 4 つまで増やせる。規則:
 * - 配る順はプレイヤー → ディーラー（表）→ プレイヤー → ディーラー（伏せる）
 * - ディーラーが A か 10 点のカードを見せていたら、伏せたカードでブラックジャックかを確かめ、そうなら表にしてすぐ精算する
 *   （プレイヤーもブラックジャックなら引き分け、それ以外の手は賭けたチップだけ負ける）。インシュランスはない
 * - プレイヤーのブラックジャックは 3:2 で払う
 * - ダブルは最初の 2 枚のときだけ。分けた後の手もダブルできる。A を分けた手はできない
 * - 分けられるのは同じ点の 2 枚（10 と K も分けられる）で、4 つの手まで。A を分けた手は 1 枚ずつ引いて止め、分け直せない
 * - 21 になった手は、そこで止める
 * - ディーラーはソフト 17 を含めて 17 以上で止める。プレイヤーの手がすべて決着していたら（バーストかブラックジャック）、引かない
 * - サレンダーはない
 *
 * ダブルと分けるには、賭けているのと同じだけのチップが手元に要る（funds）。
 * fortune を渡すと、配る直前にシューの順を少しだけプレイヤーに有利に入れ替える（fortune.ts）。
 * 操作はその場で規則どおりに進め、起きた順に events へ積む。時刻は知らない。
 */
export class Round {
  readonly dealer: Card[] = [];
  readonly hands: PlayerHand[] = [];
  readonly events: RoundEvent[] = [];
  /** 操作を待っている手。待っていなければ -1 */
  active = -1;
  /** ディーラーの伏せたカードを表にしたか */
  holeRevealed = false;
  private readonly shoe: Shoe;
  private readonly fortune: Fortune | null;
  /** ダブルと分けるのに使える、手元のチップ */
  private fundsLeft: number;
  /** 賭けたチップの合計 */
  private committedChips: number;
  private over = false;

  /**
   * bet を賭けて配る。funds は賭けた後に手元に残るチップ（ダブルと分けるのに使う）。
   * 配った後、ブラックジャックで決着すればそのまま精算し、そうでなければ最初の手の操作を待つ
   */
  constructor(shoe: Shoe, bet: number, funds: number, fortune: Fortune | null = null) {
    if (bet <= 0 || bet % 2 !== 0) throw new Error('the bet must be a positive even number (blackjack pays 3:2)');
    this.shoe = shoe;
    this.fortune = fortune;
    this.fundsLeft = funds;
    this.committedChips = bet;
    this.hands.push(newHand(bet, false, false));
    this.dealTo(0, false);
    this.dealDealer(true);
    this.dealTo(0, false);
    this.dealDealer(false);
    this.opening();
  }

  /** ラウンドが終わった（精算まで済んだ） */
  get finished(): boolean {
    return this.over;
  }

  /** 賭けたチップの合計（ダブルと分けた分を含む） */
  get committed(): number {
    return this.committedChips;
  }

  /** ラウンドのチップの増減の合計（賭けたチップを除く）。終わる前は決着した手の分だけ */
  get net(): number {
    let n = 0;
    for (const h of this.hands) n += h.delta;
    return n;
  }

  /** 操作を待っている手が action を選べるか */
  can(action: Action): boolean {
    if (this.over || this.active < 0) return false;
    const h = this.hands[this.active];
    switch (action) {
      case 'hit':
      case 'stand':
        return true;
      case 'double':
        return h.cards.length === 2 && !h.splitAces && this.fundsLeft >= h.bet;
      case 'split':
        return isPair(h.cards) && !h.splitAces && this.hands.length < MAX_HANDS && this.fundsLeft >= h.bet;
    }
  }

  /** 操作を待っている手で action を選ぶ。選べなければ投げる */
  act(action: Action): void {
    if (!this.can(action)) throw new Error(`cannot ${action} now`);
    const i = this.active;
    const h = this.hands[i];
    switch (action) {
      case 'hit':
        this.dealTo(i, true);
        // まだ操作できるなら、同じ手の操作を待ち続ける
        if (this.afterDraw(i)) return;
        break;
      case 'stand':
        h.status = 'stood';
        this.events.push({ t: 'stand', hand: i, total: totalOf(h.cards), auto: false });
        break;
      case 'double':
        this.commit(h.bet);
        h.bet *= 2;
        h.doubled = true;
        this.events.push({ t: 'double', hand: i });
        this.dealTo(i, true);
        if (this.afterDraw(i)) {
          h.status = 'stood';
          this.events.push({ t: 'stand', hand: i, total: totalOf(h.cards), auto: true });
        }
        break;
      case 'split':
        this.split(i);
        return;
    }
    this.advance(i + 1);
  }

  // ---- 進行 ----

  /** 配り終えた後: ディーラーのブラックジャックを確かめ、プレイヤーのブラックジャックを払い、最初の手の操作を待つ */
  private opening(): void {
    const up = pointOf(this.dealer[0]);
    const h = this.hands[0];
    if (up === 1 || up === 10) {
      const blackjack = isNatural(this.dealer);
      this.events.push({ t: 'peek', blackjack });
      if (blackjack) {
        this.reveal();
        this.events.push({ t: 'dealerNatural' });
        if (isNatural(h.cards)) {
          h.status = 'natural';
          this.events.push({ t: 'natural', hand: 0 });
          this.settle(0, 'push');
        } else {
          h.status = 'stood';
          this.settle(0, 'lose');
        }
        this.finish();
        return;
      }
    }
    if (isNatural(h.cards)) {
      h.status = 'natural';
      this.events.push({ t: 'natural', hand: 0 });
      this.settle(0, 'blackjack');
      this.dealerTurn();
      return;
    }
    this.advance(0);
  }

  /** 手 i を 2 つに分ける。分けた手にそれぞれ 2 枚目を配る（A は 1 枚ずつ配って止める） */
  private split(i: number): void {
    const h = this.hands[i];
    const aces = pointOf(h.cards[0]) === 1;
    this.commit(h.bet);
    const second = h.cards.pop() as Card;
    const left = newHand(h.bet, true, aces);
    left.cards.push(h.cards[0]);
    const right = newHand(h.bet, true, aces);
    right.cards.push(second);
    this.hands.splice(i, 1, left, right);
    this.events.push({ t: 'split', hand: i });
    this.dealTo(i, false);
    if (aces) {
      this.dealTo(i + 1, false);
      for (const k of [i, i + 1]) {
        this.hands[k].status = 'stood';
        this.events.push({ t: 'stand', hand: k, total: totalOf(this.hands[k].cards), auto: true });
      }
      this.advance(i + 2);
      return;
    }
    if (totalOf(left.cards) === BLACKJACK) {
      left.status = 'stood';
      this.events.push({ t: 'stand', hand: i, total: BLACKJACK, auto: true });
      this.advance(i + 1);
      return;
    }
    this.active = i;
    this.events.push({ t: 'turn', hand: i });
  }

  /** 手 i に引いた後。21 を超えたらバーストで負け、21 なら止める。まだ操作できるなら true */
  private afterDraw(i: number): boolean {
    const h = this.hands[i];
    if (isBust(h.cards)) {
      h.status = 'bust';
      this.events.push({ t: 'bust', hand: i, total: totalOf(h.cards) });
      this.settle(i, 'lose');
      return false;
    }
    if (totalOf(h.cards) === BLACKJACK) {
      h.status = 'stood';
      this.events.push({ t: 'stand', hand: i, total: BLACKJACK, auto: true });
      return false;
    }
    return true;
  }

  /** from 番目以降で、まだ操作できる最初の手の操作を待つ。分けた直後で 1 枚の手には 2 枚目を配る。なければディーラーの番 */
  private advance(from: number): void {
    for (let i = from; i < this.hands.length; i++) {
      const h = this.hands[i];
      if (h.status !== 'playing') continue;
      if (h.cards.length === 1) {
        this.dealTo(i, false);
        if (totalOf(h.cards) === BLACKJACK) {
          h.status = 'stood';
          this.events.push({ t: 'stand', hand: i, total: BLACKJACK, auto: true });
          continue;
        }
      }
      this.active = i;
      this.events.push({ t: 'turn', hand: i });
      return;
    }
    this.active = -1;
    this.dealerTurn();
  }

  /**
   * ディーラーの番: 伏せたカードを表にし、ディーラーと比べる手が残っていれば 17 以上になるまで引いて、残りの手を精算する
   */
  private dealerTurn(): void {
    this.active = -1;
    const contested = this.hands.some((h) => h.status === 'stood');
    this.reveal();
    if (contested) {
      let target = 0;
      for (const h of this.hands) if (h.status === 'stood') target = Math.max(target, totalOf(h.cards));
      while (totalOf(this.dealer) < DEALER_STANDS) {
        this.fortune?.beforeDealerDraw(this.shoe, this.dealer, target);
        this.dealDealer(true);
      }
      const total = totalOf(this.dealer);
      this.events.push(total > BLACKJACK ? { t: 'dealerBust', total } : { t: 'dealerStand', total });
    }
    const dealerTotal = totalOf(this.dealer);
    const dealerBust = dealerTotal > BLACKJACK;
    this.hands.forEach((h, i) => {
      if (h.result !== null) return;
      const mine = totalOf(h.cards);
      this.settle(i, dealerBust || mine > dealerTotal ? 'win' : mine < dealerTotal ? 'lose' : 'push');
    });
    this.finish();
  }

  private finish(): void {
    this.over = true;
    this.active = -1;
    this.events.push({ t: 'end' });
  }

  // ---- カードとチップ ----

  private dealTo(i: number, chosen: boolean): void {
    if (chosen) this.fortune?.beforePlayerDraw(this.shoe, this.hands[i].cards);
    const card = this.draw();
    this.hands[i].cards.push(card);
    this.events.push({ t: 'deal', hand: i, card, faceUp: true, chosen });
  }

  private dealDealer(faceUp: boolean): void {
    if (!faceUp) this.fortune?.beforeHoleCard(this.shoe, this.dealer[0]);
    const card = this.draw();
    this.dealer.push(card);
    this.events.push({ t: 'deal', hand: DEALER, card, faceUp, chosen: false });
  }

  /** シューから 1 枚引く。尽きて捨てたカードを混ぜ直したら、その出来事を先に積む */
  private draw(): Card {
    const shoe = this.shoe;
    const before = shoe.reshuffles;
    if (shoe.remaining === 0) {
      const card = shoe.draw();
      if (shoe.reshuffles !== before) {
        const remaining = Int32Array.from(shoe.remainingByPoint);
        remaining[pointOf(card) - 1]++;
        this.events.push({ t: 'reshuffle', remaining });
      }
      return card;
    }
    return shoe.draw();
  }

  private reveal(): void {
    this.holeRevealed = true;
    this.events.push({ t: 'reveal', card: this.dealer[1] });
  }

  private settle(i: number, result: HandResult): void {
    const h = this.hands[i];
    h.result = result;
    h.delta = result === 'blackjack' ? (h.bet * 3) / 2 : result === 'win' ? h.bet : result === 'lose' ? -h.bet : 0;
    this.events.push({ t: 'settle', hand: i, result, delta: h.delta });
  }

  private commit(chips: number): void {
    this.fundsLeft -= chips;
    this.committedChips += chips;
  }
}

function newHand(bet: number, fromSplit: boolean, splitAces: boolean): PlayerHand {
  return { cards: [], bet, fromSplit, splitAces, doubled: false, status: 'playing', result: null, delta: 0 };
}
