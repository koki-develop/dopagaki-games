import { BOARD_SIZE, colOf, rowOf, squareOf } from './rules/position.ts';

/*
 * 盤のワールド座標。マス (列 c, 行 r) の中心は (c + 0.5, BOARD_SIZE - r - 0.5)。
 * 盤は x・y とも 0〜8 に置き、行 0（記法の 1）が上になるよう y は上向きに取る。
 */

/** 盤の枠の太さ（ワールド単位） */
export const BOARD_FRAME = 0.34;
/** 画面に収める盤の幅（枠を含む、ワールド単位） */
const BOARD_SPAN = BOARD_SIZE + BOARD_FRAME * 2;
/** 盤の左右に空ける最小の余白（CSS ピクセル） */
const SIDE_GUTTER = 10;

export type Layout = {
  /** CSS ピクセル */
  width: number;
  height: number;
  /** 1 ワールド単位あたりの CSS ピクセル */
  pxPerUnit: number;
  /** ワールドの原点（盤の左下）の、描画領域の左上からの CSS ピクセル位置 */
  originX: number;
  originY: number;
  /** カメラに映すワールド座標の範囲 */
  left: number;
  right: number;
  bottom: number;
  top: number;
};

/**
 * 画面に盤を収める配置を決める。上に topReservedPx、下に bottomReservedPx を空け、残りの領域の中央に置く。
 * 縦長の端末では幅に合わせ、横長の端末では高さに合わせる。
 */
export function computeLayout(width: number, height: number, topReservedPx: number, bottomReservedPx: number): Layout {
  const availW = Math.max(1, width - SIDE_GUTTER * 2);
  const availH = Math.max(1, height - topReservedPx - bottomReservedPx);
  const pxPerUnit = Math.max(1e-3, Math.min(availW / BOARD_SPAN, availH / BOARD_SPAN));
  const boardPx = BOARD_SIZE * pxPerUnit;
  const originX = (width - boardPx) / 2;
  const originY = topReservedPx + (availH + boardPx) / 2;
  const left = -originX / pxPerUnit;
  const right = left + width / pxPerUnit;
  const top = originY / pxPerUnit;
  const bottom = top - height / pxPerUnit;
  return { width, height, pxPerUnit, originX, originY, left, right, bottom, top };
}

/** マスの中心のワールド座標 */
export const cellX = (square: number): number => colOf(square) + 0.5;
export const cellY = (square: number): number => BOARD_SIZE - rowOf(square) - 0.5;

/** 描画領域の左上からの CSS ピクセル位置にあるマス。盤の外なら -1 */
export function squareAt(l: Layout, px: number, py: number): number {
  const x = (px - l.originX) / l.pxPerUnit;
  const y = (l.originY - py) / l.pxPerUnit;
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return -1;
  return squareOf(Math.floor(x), BOARD_SIZE - 1 - Math.floor(y));
}

/** ワールド座標の、描画領域の左上からの CSS ピクセル位置 */
export const toPxX = (l: Layout, x: number): number => l.originX + x * l.pxPerUnit;
export const toPxY = (l: Layout, y: number): number => l.originY - y * l.pxPerUnit;
