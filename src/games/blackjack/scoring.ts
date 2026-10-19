import { multiplierTenths } from './streak.ts';

/** 始めの手持ちのチップと、1 回のプレイのラウンドの数 */
export const START_CHIPS = 1000;
export const ROUNDS = 8;

/**
 * 1 ラウンドの賭けの決まり。賭けは BET_STEP の倍数で、MIN_BET 以上、手持ち以下（上限はない）。
 * ブラックジャックは 3:2 で払うので、BET_STEP の倍数の賭けなら払い戻しは CHIP_UNIT の倍数になる
 */
export const MIN_BET = 10;
export const BET_STEP = 10;
/** 払い戻しの最小の単位（いちばん小さいチップ）。連勝の上乗せの端数は、この単位に切り捨てる */
export const CHIP_UNIT = 5;
/** 最初のラウンドに置いておく賭け */
export const FIRST_BET = 100;

/** 手持ちが chips のときに賭けられる上限（手持ちを BET_STEP の倍数に切り捨てた額。MIN_BET 未満なら賭けられない） */
export function betLimit(chips: number): number {
  return Math.floor(chips / BET_STEP) * BET_STEP;
}

/** bet を、手持ち chips で賭けられる値へ収める（BET_STEP の倍数に切り捨て、MIN_BET から上限まで）。賭けられなければ 0 */
export function fitBet(bet: number, chips: number): number {
  const limit = betLimit(chips);
  if (limit < MIN_BET) return 0;
  return Math.min(limit, Math.max(MIN_BET, Math.floor(bet / BET_STEP) * BET_STEP));
}

/** bet を手持ち chips で賭けられるか */
export function isValidBet(bet: number, chips: number): boolean {
  return Number.isInteger(bet) && bet % BET_STEP === 0 && bet >= MIN_BET && bet <= betLimit(chips);
}

/**
 * 1 ラウンドの払い戻し。手ごとのチップの増減（賭けたチップを除く）から決める。
 * ラウンドの増減の合計 net が正（勝ったラウンド）なら、勝った手の分（won）に連勝の倍率を掛けた上乗せ（bonus）を足す。
 * 負けた手の分（lost）には倍率を掛けない。
 */
export type RoundPayout = {
  /** 倍率を掛ける前のラウンドの増減の合計 */
  readonly net: number;
  /** 勝った手のチップの合計と、負けた手で失ったチップの合計（正の値） */
  readonly won: number;
  readonly lost: number;
  /** 掛けた倍率（1/10 単位。勝ったラウンドでなければ 10） */
  readonly multiplierTenths: number;
  /** 倍率による上乗せ（CHIP_UNIT の倍数に切り捨てる） */
  readonly bonus: number;
  /** 上乗せを含めたラウンドの増減 */
  readonly total: number;
};

/** 手ごとの増減 deltas と、このラウンドを数えた後の連勝 streak から払い戻しを決める */
export function payoutOf(deltas: readonly number[], streak: number): RoundPayout {
  let won = 0;
  let lost = 0;
  for (const d of deltas) {
    if (d > 0) won += d;
    else lost -= d;
  }
  const net = won - lost;
  const tenths = net > 0 ? multiplierTenths(streak) : 10;
  const bonus = Math.floor((won * (tenths - 10)) / (10 * CHIP_UNIT)) * CHIP_UNIT;
  return { net, won, lost, multiplierTenths: tenths, bonus, total: net + bonus };
}

/** 1 回のプレイの得点の内訳。結果画面で 1 行ずつ出す。total は最後の手持ちのチップ（スコア） */
export type ScoreSheet = {
  readonly start: number;
  readonly won: number;
  readonly bonus: number;
  readonly lost: number;
  readonly total: number;
};

/** 1 回のプレイの払い戻しを積み上げる */
export class Ledger {
  won = 0;
  bonus = 0;
  lost = 0;

  add(p: RoundPayout): void {
    this.won += p.won;
    this.bonus += p.bonus;
    this.lost += p.lost;
  }

  sheet(start: number): ScoreSheet {
    return { start, won: this.won, bonus: this.bonus, lost: this.lost, total: start + this.won + this.bonus - this.lost };
  }
}
