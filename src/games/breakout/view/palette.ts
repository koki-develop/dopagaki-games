import { BlockType } from '../config.ts';

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
/** ハードの色は、行の高さの色をこの割合だけ HARD_RGB へ寄せる */
export const HARD_MIX = 0.75;

/** 壊れないブロックの色。行の高さでは変えず、色味の薄い青みの鋼にする */
export const SOLID_RGB: readonly [number, number, number] = [0.48, 0.56, 0.72];

/** ボール大量ブロックの虹色の縁: ブロックの中心からの横の位置 1 u あたりと、1 秒あたりに進む色相 */
export const MEGA_HUE_PER_X = 0.35;
export const MEGA_HUE_SPEED = 0.5;

/**
 * ブロックの色（シェーダーの縁の色と同じ）を CPU で計算する。
 * yOverField は高さの割合（0〜1）。localX（ブロックの中心からの横の位置）と time（u.time の時間軸の秒）は、
 * 位置と時刻で色が変わるボール大量ブロックだけが使う
 */
export function blockRgb(
  type: number,
  yOverField: number,
  localX: number,
  time: number,
  out: [number, number, number],
): [number, number, number] {
  if (type === BlockType.Solid) {
    out[0] = SOLID_RGB[0];
    out[1] = SOLID_RGB[1];
    out[2] = SOLID_RGB[2];
    return out;
  }
  const hue = blockHue(yOverField);
  if (type === BlockType.Mega) return neonRgb(hue + localX * MEGA_HUE_PER_X + time * MEGA_HUE_SPEED, out);
  neonRgb(hue, out);
  if (type === BlockType.Hard) {
    out[0] += (HARD_RGB[0] - out[0]) * HARD_MIX;
    out[1] += (HARD_RGB[1] - out[1]) * HARD_MIX;
    out[2] += (HARD_RGB[2] - out[2]) * HARD_MIX;
  }
  return out;
}
