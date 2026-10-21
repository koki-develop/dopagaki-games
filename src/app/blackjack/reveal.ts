import { RESULT_INPUT_GUARD_MS } from '../../games/blackjack/controller.ts';

/**
 * 結果画面の演出の時刻（ms、結果画面を出した時点から）。CSS のアニメーションへは、結果画面がカスタムプロパティで渡す。
 * 見出しは headingMs かけて叩きつけられ、その 60% の時点（330ms）で縮みきって着地する。
 */
export const RESULT_REVEAL = {
  /** 見出しが叩きつけられる演出の長さ */
  headingMs: 550,
  /** 見出しの着地の直後。ここから操作を受け付ける */
  settleMs: RESULT_INPUT_GUARD_MS,
  /** 増減の行が弾けて出る時刻と、弾けて出る演出の長さ（NEW BEST! も同じ長さ） */
  netAtMs: 250,
  popMs: 400,
  /** 得点の内訳の最初の行が出る時刻と、次の行までの間隔 */
  sheetAtMs: 550,
  lineStepMs: 220,
  /** 内訳を出しきってから、合計をカウントアップする長さ */
  totalCountMs: 1100,
  /** 合計を数え終えてから、記録の更新が弾けて出るまで */
  newBestAfterMs: 150,
  /**
   * 累計の欄は合計と同時に出て、スコアの演出（合計のカウントアップと、更新したら NEW BEST!）が終わるまでこのプレイの前の累計を見せる。
   * 終わってから lifetimeAfterMs 置いて、今の累計へ lifetimeCountMs かけて数える
   */
  lifetimeAfterMs: 150,
  lifetimeCountMs: 700,
} as const;

/** 結果画面の演出のうち、内訳の行の数と記録の更新で決まる時刻（ms、結果画面を出した時点から） */
export type ResultTimeline = {
  /** 合計のカウントアップを始め、合計と累計の欄が弾けて出る時刻 */
  totalAt: number;
  /** NEW BEST! が弾けて出る時刻 */
  newBestAt: number;
  /** 累計を数え始める時刻 */
  lifetimeCountAt: number;
};

/** lineCount は得点の内訳の行の数、newBest は最高スコアを更新したか */
export function resultTimeline(lineCount: number, newBest: boolean): ResultTimeline {
  const totalAt = RESULT_REVEAL.sheetAtMs + lineCount * RESULT_REVEAL.lineStepMs;
  const totalEnd = totalAt + RESULT_REVEAL.totalCountMs;
  const newBestAt = totalEnd + RESULT_REVEAL.newBestAfterMs;
  const scoreSettled = newBest ? newBestAt + RESULT_REVEAL.popMs : totalEnd;
  return { totalAt, newBestAt, lifetimeCountAt: scoreSettled + RESULT_REVEAL.lifetimeAfterMs };
}
