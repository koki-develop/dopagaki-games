/** ネオンの色の彩度。シェーダーの neon() と CPU の neonRgb() が共有する */
export const NEON_SATURATION = 0.78;
const fract = (v: number) => v - Math.floor(v);
const channel = (h: number, offset: number) => {
  const k = Math.min(1, Math.max(0, Math.abs(fract(h + offset) * 6 - 3) - 1));
  return 1 + (k - 1) * NEON_SATURATION;
};

/** シェーダーの neon() と同じ色を CPU で計算する。t は色相 */
export function neonRgb(t: number, out: [number, number, number]): [number, number, number] {
  out[0] = channel(t, 1);
  out[1] = channel(t, 2 / 3);
  out[2] = channel(t, 1 / 3);
  return out;
}

/**
 * ブロックの色相は、行の高さだけで決める（下がシアン、上がマゼンタ）。ボール数の段階などで変えない。
 * シェーダーと CPU（破片や火花の色）の両方がこの定数を使う。
 */
export const BLOCK_HUE_BOTTOM = 0.5;
export const BLOCK_HUE_SPAN = 0.36;

/** 高さの割合（0〜1）に対するブロックの色相 */
export const blockHue = (yOverField: number): number => BLOCK_HUE_BOTTOM + yOverField * BLOCK_HUE_SPAN;

export const HARD_RGB: readonly [number, number, number] = [1.0, 0.72, 0.3];
