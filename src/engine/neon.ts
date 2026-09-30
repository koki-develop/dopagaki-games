/** ネオンの色の彩度。シェーダーの neon()（tsl.ts）と CPU の neonRgb() が共有する */
export const NEON_SATURATION = 0.78;

const fract = (v: number) => v - Math.floor(v);
const channel = (h: number, offset: number) => {
  const k = Math.min(1, Math.max(0, Math.abs(fract(h + offset) * 6 - 3) - 1));
  return 1 + (k - 1) * NEON_SATURATION;
};

/** シェーダーの neon() と同じ色を CPU で計算する。t は色相（0 赤、1/3 緑、1/2 シアン、2/3 青、5/6 マゼンタ） */
export function neonRgb(t: number, out: [number, number, number]): [number, number, number] {
  out[0] = channel(t, 1);
  out[1] = channel(t, 2 / 3);
  out[2] = channel(t, 1 / 3);
  return out;
}
