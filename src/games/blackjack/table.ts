import type { Fortune } from './rules/fortune.ts';
import { Round } from './rules/round.ts';
import type { Action } from './rules/round.ts';
import type { Shoe } from './rules/shoe.ts';
import { isValidBet, Ledger, MIN_BET, payoutOf, ROUNDS, START_CHIPS } from './scoring.ts';
import type { RoundPayout, ScoreSheet } from './scoring.ts';
import { Streak } from './streak.ts';
import type { StreakChange } from './streak.ts';

/** 1 ラウンドを精算した結果 */
export type RoundSettlement = {
  readonly payout: RoundPayout;
  readonly streak: StreakChange;
  /** 配る前と、精算した後の手持ちのチップ */
  readonly chipsBefore: number;
  readonly chips: number;
};

/**
 * 1 回のプレイ（ROUNDS ラウンド）。手持ちのチップ・シュー・連勝・払い戻しの記録を持ち、ラウンドを 1 つずつ配って精算する。
 * 時刻も演出も知らない。
 *
 * - ラウンドごとに賭けを決めて配る（scoring.ts の賭けの決まり）。ダブルと分けるときは、手持ちから同じだけ足す
 * - ROUNDS ラウンドを精算したら終わる。手持ちが MIN_BET より少なくなったら（破産）、そこで終わる
 * - chips は場に出していない手持ちのチップ。精算で、勝った手の払い戻しと引き分けの手の賭けが戻り、連勝の上乗せが入る
 * - シューは 1 回のプレイで混ぜ直さずに使い続ける（尽きたら捨てたカードを混ぜ直す）
 * - fortune を渡すと、どのラウンドもそれで配る（rules/fortune.ts）
 */
export class Table {
  readonly shoe: Shoe;
  readonly streak = new Streak();
  readonly ledger = new Ledger();
  readonly startChips: number;
  /** 場に出していない手持ちのチップ */
  chips: number;
  /** 今のラウンド。最初のラウンドを配る前は null */
  round: Round | null = null;
  /** 配ったラウンドの数 */
  rounds = 0;
  /** プレイヤーのブラックジャックの数 */
  blackjacks = 0;
  /** 配る前の手持ち（ダブルと分けた分を、ここから引いて chips にする） */
  private chipsAtDeal = 0;
  private settled = true;
  private readonly fortune: Fortune | null;

  constructor(shoe: Shoe, chips = START_CHIPS, fortune: Fortune | null = null) {
    this.shoe = shoe;
    this.fortune = fortune;
    this.startChips = chips;
    this.chips = chips;
  }

  /** 次のラウンドを配れるか（前のラウンドを精算し終え、ROUNDS ラウンドを配っておらず、賭けられるだけのチップがある） */
  get canDeal(): boolean {
    return this.settled && this.rounds < ROUNDS && this.chips >= MIN_BET;
  }

  /** プレイが終わった（精算し終えて、次のラウンドを配れない） */
  get over(): boolean {
    return this.settled && !this.canDeal;
  }

  /** 賭けられるだけのチップがない */
  get broke(): boolean {
    return this.chips < MIN_BET;
  }

  /** 次のラウンドを bet を賭けて配る。配れないか、賭けられない額なら投げる */
  deal(bet: number): Round {
    if (!this.canDeal) throw new Error('cannot deal now');
    if (!isValidBet(bet, this.chips)) throw new Error(`invalid bet ${bet} with ${this.chips} chips`);
    this.chipsAtDeal = this.chips;
    this.chips -= bet;
    const round = new Round(this.shoe, bet, this.chips, this.fortune);
    this.round = round;
    this.rounds++;
    this.settled = false;
    this.syncChips();
    return round;
  }

  /** 今のラウンドで action を選ぶ。選べなければ投げる */
  act(action: Action): void {
    const r = this.round;
    if (!r) throw new Error('no round');
    r.act(action);
    this.syncChips();
  }

  /** 終わったラウンドを精算する。場のカードを捨て、連勝を数え、チップを戻す */
  settle(): RoundSettlement {
    const r = this.round;
    if (!r || !r.finished || this.settled) throw new Error('the round is not ready to settle');
    this.settled = true;
    const streak = this.streak.record(r.net);
    const payout = payoutOf(
      r.hands.map((h) => h.delta),
      streak.after,
    );
    this.ledger.add(payout);
    let back = payout.bonus;
    for (const h of r.hands) {
      back += h.bet + h.delta;
      if (h.result === 'blackjack') this.blackjacks++;
    }
    this.chips += back;
    for (const h of r.hands) this.shoe.discard(h.cards);
    this.shoe.discard(r.dealer);
    return { payout, streak, chipsBefore: this.chipsAtDeal, chips: this.chips };
  }

  /** 得点の内訳。total は今の手持ち（プレイが終わっていれば最後の手持ち） */
  sheet(): ScoreSheet {
    return this.ledger.sheet(this.startChips);
  }

  /** ラウンドの中で、ダブルと分けた分を手持ちから引く */
  private syncChips(): void {
    const r = this.round;
    if (r && !this.settled) this.chips = this.chipsAtDeal - r.committed;
  }
}
