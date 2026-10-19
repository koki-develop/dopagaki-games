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
} as const;
