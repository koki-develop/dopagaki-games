import type { Color } from '../rules/position.ts';

type Rgb = readonly [number, number, number];

/**
 * 石の縁の色相。黒い石はマゼンタ寄りの紫、白い石はシアン。シェーダーの neon() と CPU の neonRgb() が共有する
 */
export const RIM_HUE: Readonly<Record<Color, number>> = { 0: 0.8, 1: 0.52 };

/** 盤の線の色相。人の手番はミント、CPU の手番はマゼンタに寄せる */
export const HUMAN_LINE_HUE = 0.45;
export const CPU_LINE_HUE = 0.9;

/** 石の面の色（明るさは LOOK.disc で掛ける前の色味） */
export const FACE_RGB: Readonly<Record<Color, Rgb>> = {
  0: [0.55, 0.5, 0.75],
  1: [0.95, 0.97, 1.0],
};

/** 石の厚みの面の色味 */
export const EDGE_RGB: Readonly<Record<Color, Rgb>> = {
  0: [0.2, 0.16, 0.3],
  1: [0.7, 0.74, 0.8],
};

/** CPU の手で出す、暗い煙の粒の色 */
export const SMOKE_RGB: Rgb = [0.22, 0.14, 0.3];

/** 確定石の光（淡い金） */
export const STABLE_RGB: Rgb = [1.0, 0.86, 0.5];
