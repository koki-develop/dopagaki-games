import { popcount } from './rules/bits.ts';
import { isCorner } from './rules/position.ts';
import type { MoveOutcome } from './rules/position.ts';

/**
 * スコアの配点。
 * 1 手ごとの点は、返した枚数・角・確定石から決めてコンボの倍率を掛け、早打ちなら早打ちの点を足す。
 * 終局では、石の数・勝敗・コンボ（最大コンボか、フルコンボ）の点を足す。
 * 多く返すことだけを狙って負けるより、勝つほうが高い点になるように、終局の点を大きくしてある。
 */
export const SCORE = {
  /** 1 手で返した n 枚目の石の点は n × flip。多く返す手ほど、1 枚あたりの点が高い */
  flip: 10,
  /** 角を取った手 */
  corner: 500,
  /** その手で、自分の確定石が 1 つ増えるごとに */
  stable: 20,
  /** コンボ 1 つあたりの倍率の上乗せと、倍率の上限（どちらも 1/10 単位。コンボ 1 で ×1） */
  comboStepTenths: 1,
  comboCapTenths: 30,
  /** 終局: 自分の石 1 つあたり */
  disc: 100,
  /** 終局: 勝ち */
  win: 5000,
  /** 終局: 相手の石を 0 にして勝った */
  perfect: 20000,
  /** 早打ちの手（combo.ts の QUICK_WINDOW 以内に打った手）に足す点。コンボの倍率は掛けない */
  quick: 200,
  /** 終局: 最大コンボ 1 つあたり */
  maxCombo: 200,
  /** 終局: 盤が全部埋まるまで、一度もコンボが途切れなかった。最大コンボの点の代わりに付ける */
  fullCombo: 10000,
} as const;

/** 1 手の点の内訳 */
export type MoveScore = {
  /** 返した石の点 */
  flips: number;
  corner: number;
  stable: number;
  /** 倍率を掛ける前の合計 */
  base: number;
  /** コンボの倍率 */
  multiplier: number;
  /** 早打ちの点（早打ちでなければ 0） */
  quick: number;
  /** この手の点（倍率を掛けて整数に丸めた点に、早打ちの点を足す） */
  total: number;
};

/** 人の 1 手の点を決める材料 */
export type MoveInput = {
  /** 返した枚数 */
  flipped: number;
  corner: boolean;
  /** この手で新しく確定石になった自分の石の数 */
  stableGained: number;
  /** この手を含めたコンボ */
  combo: number;
  quick: boolean;
};

/** 終局の点の内訳。結果画面で 1 行ずつ足していく。石の数と最大コンボそのものは RunResult が持つ */
export type ScoreSheet = {
  /** 対局中の手の点の合計（早打ちの点を除く） */
  moves: number;
  /** 早打ちの点の合計 */
  quick: number;
  /** 終局の自分の石の点 */
  discPoints: number;
  /** 勝ちとパーフェクトの点（当てはまらなければ 0） */
  win: number;
  perfect: number;
  /** コンボの点。フルコンボなら SCORE.fullCombo、そうでなければ最大コンボの点 */
  comboPoints: number;
  total: number;
};

/** 終局の点を決める材料 */
export type FinalInput = {
  /** 対局中の手の点の合計（早打ちの点を除く）と、早打ちの点の合計 */
  moves: number;
  quick: number;
  /** 終局の自分の石の数 */
  discs: number;
  won: boolean;
  perfect: boolean;
  maxCombo: number;
  fullCombo: boolean;
};

/** 1 手で n 枚返したときの、返した石の点 */
export const flipPoints = (n: number): number => (SCORE.flip * n * (n + 1)) / 2;

/** コンボ combo（1 で最初の 1 手）の倍率。0.1 刻みで、上限は comboCapTenths */
export function comboMultiplier(combo: number): number {
  const tenths = 10 + SCORE.comboStepTenths * Math.max(0, combo - 1);
  return Math.min(SCORE.comboCapTenths, tenths) / 10;
}

/** 人の 1 手の点 */
export function scoreMove(m: MoveInput): MoveScore {
  const flips = flipPoints(m.flipped);
  const cornerPoints = m.corner ? SCORE.corner : 0;
  const stable = SCORE.stable * m.stableGained;
  const base = flips + cornerPoints + stable;
  const multiplier = comboMultiplier(m.combo);
  const quick = m.quick ? SCORE.quick : 0;
  return { flips, corner: cornerPoints, stable, base, multiplier, quick, total: Math.round(base * multiplier) + quick };
}

/** 終局の点を足す */
export function finalSheet(f: FinalInput): ScoreSheet {
  const discPoints = SCORE.disc * f.discs;
  const win = f.won ? SCORE.win : 0;
  const perfect = f.perfect ? SCORE.perfect : 0;
  const comboPoints = f.fullCombo ? SCORE.fullCombo : SCORE.maxCombo * f.maxCombo;
  return {
    moves: f.moves,
    quick: f.quick,
    discPoints,
    win,
    perfect,
    comboPoints,
    total: f.moves + f.quick + discPoints + win + perfect + comboPoints,
  };
}

/**
 * 1 局の人の手の点を数える。打つたびに、返した枚数・角・その手で増えた確定石とコンボから点を決め、合計に足す。
 */
export class ScoreKeeper {
  /** 対局中の手の点の合計（早打ちの点を除く）と、早打ちの点の合計・回数 */
  moves = 0;
  quick = 0;
  quickCount = 0;

  /** 対局中の得点（手の点と早打ちの点の合計） */
  get total(): number {
    return this.moves + this.quick;
  }

  /**
   * 人の手 outcome の点を決めて合計に足す。stableGained はこの手で新しく確定石になった人の石の数、
   * combo はこの手を含めたコンボ、quick は早打ちか
   */
  add(outcome: MoveOutcome, stableGained: number, combo: number, quick: boolean): MoveScore {
    const flipped = popcount(outcome.flipped.hi, outcome.flipped.lo);
    const score = scoreMove({ flipped, corner: isCorner(outcome.square), stableGained, combo, quick });
    this.moves += score.total - score.quick;
    this.quick += score.quick;
    if (quick) this.quickCount++;
    return score;
  }
}
