import { RESULT_INPUT_GUARD_MS } from '../../games/breakout/controller.ts';

/**
 * 結果画面の演出の時刻（ms、結果画面を出した時点から）。CSS のアニメーションへは、結果画面がカスタムプロパティで渡す。
 * 見出しは headingMs かけて叩きつけられ、その 60% の時点（330ms）で縮みきって着地する。
 */
export const RESULT_REVEAL = {
  /** 見出しが叩きつけられる演出の長さ */
  headingMs: 550,
  /** 見出しの着地の直後。ここから操作を受け付け、スコアのカウントアップを始める */
  settleMs: RESULT_INPUT_GUARD_MS,
  /** スコアの枠が弾けて出る時刻 */
  scorePopAtMs: 250,
  /** スコアの枠と NEW BEST! が弾けて出る演出の長さ */
  popMs: 400,
  /** スコアのカウントアップの長さ */
  countUpMs: 1100,
  /** NEW BEST! が弾けて出る時刻 */
  newBestAtMs: 1100,
} as const;
