/** v を lo〜hi に収める */
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 0 から seconds 秒かけて 0 → 1 へ直線で上がる値。seconds が 0 以下なら最初から 1 */
export const ramp = (t: number, seconds: number): number => (seconds > 0 ? clamp01(t / seconds) : 1);
/** 経過時間 dt の間に、時定数 tau で target へ近づける指数スムージング */
export const damp = (current: number, target: number, tau: number, dt: number): number =>
  tau <= 0 ? target : target + (current - target) * Math.exp(-dt / tau);

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
