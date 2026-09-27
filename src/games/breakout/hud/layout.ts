import type { HudLayout } from '../types.ts';

export type Box = { left: number; top: number; width: number; height: number };

/**
 * HUD の配置を、画面上の矩形から求める。
 * origin はゲームの描画領域、hud は HUD 全体、score はスコアの枠（変形をかける前の位置）。
 * safeBottom は画面下端の安全領域（CSS ピクセル）。
 */
export function computeHudLayout(origin: Box, hud: Box, score: Box | null, safeBottom: number): HudLayout {
  return {
    top: Math.max(0, hud.top + hud.height - origin.top),
    bottom: Math.max(0, safeBottom),
    scoreAnchor: score ? { x: score.left + score.width / 2 - origin.left, y: score.top + score.height / 2 - origin.top } : null,
  };
}

export function sameHudLayout(a: HudLayout | null, b: HudLayout): boolean {
  if (!a || a.top !== b.top || a.bottom !== b.bottom) return false;
  if (!a.scoreAnchor || !b.scoreAnchor) return a.scoreAnchor === b.scoreAnchor;
  return a.scoreAnchor.x === b.scoreAnchor.x && a.scoreAnchor.y === b.scoreAnchor.y;
}
