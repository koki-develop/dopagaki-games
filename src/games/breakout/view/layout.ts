import { FIELD_H, FIELD_W } from '../config.ts';

export type Layout = {
  /** CSS ピクセル */
  width: number;
  height: number;
  /** 1 ワールド単位あたりの CSS ピクセル */
  pxPerUnit: number;
  /** フィールド左下（0, 0）の、画面左上からの CSS ピクセル位置 */
  fieldLeftPx: number;
  fieldBottomPx: number;
  /** カメラに映すワールド座標の範囲 */
  left: number;
  right: number;
  bottom: number;
  top: number;
};

/**
 * 画面にフィールド（幅 9 × 高さ 16）を収める配置を決める。
 * フィールドの上には HUD と安全領域（ノッチ）のぶん topReservedPx を空け、残りの領域の中央に置く。
 * 縦長の端末では幅に合わせ、横長の端末では高さに合わせる。フィールドの外は背景で埋める。
 */
export function computeLayout(width: number, height: number, topReservedPx: number, bottomReservedPx: number): Layout {
  const availH = Math.max(1, height - topReservedPx - bottomReservedPx);
  const pxPerUnit = Math.max(1e-3, Math.min(width / FIELD_W, availH / FIELD_H));
  const fieldWpx = FIELD_W * pxPerUnit;
  const fieldHpx = FIELD_H * pxPerUnit;
  const fieldLeftPx = (width - fieldWpx) / 2;
  const fieldTopPx = topReservedPx + (availH - fieldHpx) / 2;
  const fieldBottomPx = fieldTopPx + fieldHpx;
  const left = -fieldLeftPx / pxPerUnit;
  const right = left + width / pxPerUnit;
  const bottom = -(height - fieldBottomPx) / pxPerUnit;
  const top = bottom + height / pxPerUnit;
  return { width, height, pxPerUnit, fieldLeftPx, fieldBottomPx, left, right, bottom, top };
}
