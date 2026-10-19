/**
 * 連勝。ラウンドの増減の合計（倍率を掛ける前）が正なら 1 つ積み、負なら途切れて 0 に戻る。0（引き分け）なら変わらない。
 * 連勝が続くほど、勝ったラウンドの払い戻しに大きな倍率を掛ける（scoring.ts）。
 */
export const STREAK = {
  /** 連勝 1 つあたりの倍率の上乗せと、倍率の上限（どちらも 1/10 単位。連勝 1 で ×1、2 で ×1.5） */
  stepTenths: 5,
  capTenths: 50,
  /**
   * フィーバー: 連勝が feverStart から始まり、feverFull で最大になる。
   * ベーシックストラテジーで打つと、1 回のプレイ（8 ラウンド）の最大連勝は中央値が 2、上位 10% が 4、上位 1% が 6 で、
   * 3 割ほどのプレイでフィーバーに入る
   */
  feverStart: 3,
  feverFull: 6,
} as const;

/** 連勝 streak（このラウンドを含む）で勝ったラウンドの倍率（1/10 単位） */
export function multiplierTenths(streak: number): number {
  return Math.min(STREAK.capTenths, 10 + STREAK.stepTenths * Math.max(0, streak - 1));
}

/** 連勝 streak のときのフィーバーの強さ（0〜1）。feverStart 未満は 0 */
export function feverLevel(streak: number): number {
  if (streak < STREAK.feverStart) return 0;
  return Math.min(1, (streak - STREAK.feverStart + 1) / (STREAK.feverFull - STREAK.feverStart + 1));
}

/** 1 ラウンドの連勝の変わり方 */
export type StreakChange = {
  /** ラウンドの前と後の連勝 */
  readonly before: number;
  readonly after: number;
  /** 積んでいた連勝が途切れた */
  readonly broken: boolean;
};

export class Streak {
  count = 0;
  /** このプレイの最大 */
  best = 0;

  /** ラウンドの増減の合計 net（倍率を掛ける前）を数える */
  record(net: number): StreakChange {
    const before = this.count;
    if (net > 0) this.count++;
    else if (net < 0) this.count = 0;
    if (this.count > this.best) this.best = this.count;
    return { before, after: this.count, broken: before > 0 && this.count === 0 };
  }
}
