import type { HudLayout } from '../types.ts';

type Box = { left: number; top: number; width: number; height: number };

/**
 * HUD の配置を、画面上の矩形から求める。origin はゲームの描画領域、hud は上端の HUD、bottom は下端に空けておく余白（安全領域を含む）。
 * 盤は HUD の下端から、下端の余白の上端までの間に収める
 */
export function computeHudLayout(origin: Box, hud: Box, bottom: Box): HudLayout {
  return {
    top: Math.max(0, hud.top + hud.height - origin.top),
    bottom: Math.max(0, origin.top + origin.height - bottom.top),
  };
}

export const sameHudLayout = (a: HudLayout | null, b: HudLayout): boolean => a !== null && a.top === b.top && a.bottom === b.bottom;
