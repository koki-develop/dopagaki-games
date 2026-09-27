import { LOOK } from '../view/look.ts';

/** 壁に当たった記録を覚えておく数。古いものから上書きする */
export const WALL_HIT_SLOTS = 8;

/**
 * present の時間軸で「十分に過去」を表す時刻。衝撃波や壁の揺れの開始時刻の初期値にして、何も見せない。
 * シェーダーの uniform（f32）に入るので、経過時間の指数的な減衰が 0 になりきる範囲で、桁の大きすぎない値にする
 */
export const PRESENT_LONG_AGO = -1e4;

/** 衝撃波が出ていないときの速さ（u / 秒）。開始時刻が PRESENT_LONG_AGO なので、この値で輪は見えない */
export const SHOCK_SPEED_IDLE = 14;

/**
 * 演出の状態。1 回のプレイごとに作り直し、演出ディレクターが毎フレームすべての値を書き、描画側がそのまま uniform に写す。
 * three.js に依存しない素の値だけを持つので、演出のロジックは GPU なしで確かめられる。
 * 時刻はすべて present の時間軸（FrameTime.present、シェーダーの u.time）。
 */
export type FxState = {
  /** エンドレスかどうか（危険ラインを描く） */
  endless: boolean;
  /** ビートの直後に 1 になって減衰する値 */
  beat: number;
  /** 0〜1 の演出の強さ（破壊ペースと chain から） */
  intensity: number;
  /** ボール数の段階を滑らかにした値（0〜4） */
  tier: number;
  /** 色相のずれ（ラジアン） */
  hue: number;
  /** 背景の明るさの上乗せ（終盤の高まりなど） */
  glow: number;
  /** エンドレスで、ブロックが危険ラインにどれだけ迫っているか（0〜1） */
  danger: number;
  /** 画面全体のフラッシュの強さ。見えないほど小さくなったら 0 にする */
  flash: number;
  /** 吸い込みの強さ（0〜1）。ボールと粒を focus へ引き寄せる */
  inhale: number;
  /** 画面の縁から focus へ向かって暗く絞り込む強さ（0〜1） */
  vignette: number;
  /** ステージクリアの溜めで、すべてが吸い込まれていく点 */
  focusX: number;
  focusY: number;
  /** 衝撃波: 中心、開始時刻、速さ（u / 秒） */
  shockX: number;
  shockY: number;
  shockStart: number;
  shockSpeed: number;
  /** 壁に当たった記録。1 件あたり (y, 開始時刻, 向き -1 左 / 1 右, 強さ) の 4 値を WALL_HIT_SLOTS 件 */
  wallHits: Float32Array;
  bloomStrength: number;
  bloomRadius: number;
  /** パドルの squash & stretch（1 が基準）と、当たった瞬間の光 */
  paddleSquashX: number;
  paddleSquashY: number;
  paddleFlash: number;
};

/** 何も当たっていない壁の記録（開始時刻が PRESENT_LONG_AGO、強さ 0） */
export function createWallHits(): Float32Array {
  const hits = new Float32Array(WALL_HIT_SLOTS * 4);
  for (let i = 0; i < WALL_HIT_SLOTS; i++) {
    hits[i * 4 + 1] = PRESENT_LONG_AGO;
    hits[i * 4 + 2] = -1;
  }
  return hits;
}

/** 何も起きていない演出の状態。bloom は省略すると見た目の基準（LOOK.bloom）の値 */
export function createFxState(endless: boolean, bloomStrength: number = LOOK.bloom.base, bloomRadius: number = LOOK.bloom.radius): FxState {
  return {
    endless,
    beat: 0,
    intensity: 0,
    tier: 0,
    hue: 0,
    glow: 0,
    danger: 0,
    flash: 0,
    inhale: 0,
    vignette: 0,
    focusX: 0,
    focusY: 0,
    shockX: 0,
    shockY: 0,
    shockStart: PRESENT_LONG_AGO,
    shockSpeed: SHOCK_SPEED_IDLE,
    wallHits: createWallHits(),
    bloomStrength,
    bloomRadius,
    paddleSquashX: 1,
    paddleSquashY: 1,
    paddleFlash: 0,
  };
}
