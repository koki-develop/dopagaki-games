import { FIELD_W } from '../config.ts';
import { LOOK } from './look.ts';

/**
 * 壁の揺れの形。当たってからの時間 age、当たった高さからの距離 dy に対して、変位は
 * `w · e^(-decay·age) · sin(freq·age − spatial·dy) · e^(-spread·dy)`（age ≥ 0 のときだけ）。
 * 壁の位置は変位 × amp だけ横にずれる。シェーダーと、揺れの届く範囲の計算の両方がこの値を使う。
 */
export const WALL_WAVE = {
  decay: 5,
  freq: 30,
  spatial: 4,
  spread: 1.3,
  amp: 0.18,
} as const;

/** 壁の光の形。壁までの距離 d に対して `sharpGain · e^(-sharp·d) + softGain · e^(-soft·d)` */
export const WALL_GLOW = {
  sharp: 60,
  sharpGain: 1.2,
  soft: 9,
  softGain: 0.25,
} as const;

/** 揺れの計算を省いた画素で許す、色の各成分（HDR、露出を掛ける前）の誤差の上限 */
export const WALL_WAVE_EPSILON = 1e-4;

/**
 * GPU の f32 の exp と sin の誤差の分だけ、変位の上限を大きく見積もる倍率。
 * WGSL の sin は [-π, π] で絶対誤差 2^-11 以内、exp は相対誤差 1e-5 程度なので、1e-3 で足りる。
 */
export const GPU_MARGIN = 1 + 1e-3;

/** 範囲の外側を表す値。フィールドから十分遠く、f32 でも有限 */
const FAR = 1e6;

/** 壁の色の各成分の上限。neon() の各成分は 1 以下 */
export const WALL_COLOR_MAX = LOOK.background.wall;

/** 壁までの距離 d に対する光の強さ */
export function wallGlow(d: number): number {
  return WALL_GLOW.sharpGain * Math.exp(-WALL_GLOW.sharp * d) + WALL_GLOW.softGain * Math.exp(-WALL_GLOW.soft * d);
}

/** 光の強さの、距離に対する変化の速さの上限（d ≥ 0 でのリプシッツ定数） */
export const WALL_GLOW_LIPSCHITZ = WALL_GLOW.sharpGain * WALL_GLOW.sharp + WALL_GLOW.softGain * WALL_GLOW.soft;

/**
 * 壁の色を掛けた光が WALL_WAVE_EPSILON 以下になる距離。光は距離とともに単調に減るので二分法で求め、
 * 上側の端を返す（この距離以上なら必ず ε 以下）。
 */
export const WALL_GLOW_REACH = (() => {
  let lo = 0;
  let hi = 16;
  for (let k = 0; k < 64; k++) {
    const mid = (lo + hi) / 2;
    if (WALL_COLOR_MAX * wallGlow(mid) <= WALL_WAVE_EPSILON) hi = mid;
    else lo = mid;
  }
  return hi;
})();

export type WallHit = { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
/**
 * left・right は揺れを計算する範囲の境目。shiftLeft・shiftRight は、左右の壁が横にずれる量の上限（GPU の誤差も含む）。
 * 揺れを計算した画素でも省いた画素でも、壁のずれはこの上限以下になる。
 */
export type WallWaveBounds = { left: number; right: number; shiftLeft: number; shiftRight: number };

/**
 * 壁の揺れを計算しなければならない x の範囲を求める。x < left または x > right の画素だけで揺れを計算し、
 * それ以外の画素は変位 0 として描いても、色の各成分の差は WALL_WAVE_EPSILON 以下になる。
 *
 * hits は壁に当たった記録 (y, 開始時刻, 向き, 強さ)。time は同じフレームにシェーダーへ渡す時刻。
 * 向きが 0 以下なら左、0 以上なら右の壁を揺らす（シェーダーの step と同じ）。
 *
 * 左の壁について（右も同じ）:
 * 1. |sin| ≤ 1、e^(-spread·dy) ≤ 1 なので、変位の大きさは S = Σ |w|·e^(-decay·age)（age ≥ 0 の記録だけ）以下。
 *    壁のずれ s は |s| ≤ δ = amp·S。
 * 2. 画素から壁までの距離は |(x − s, above)|。s を 0 にしたときの距離との差は、三角不等式から |s| ≤ δ 以下。
 *    どちらの距離も x − δ 以上。
 * 3. 壁の光は wallCol · g(min(dl, dr, dc)) = wallCol · max(g(dl), g(dr), g(dc))（g は単調減少）。
 *    max は各引数について 1-リプシッツなので、g(dl) の変化がそのまま色の変化の上限になる。
 * 4. x ≥ δ + R（R = WALL_GLOW_REACH）なら、g(dl) は変える前も後も [0, g(R)] にあり、差は g(R) 以下。
 *    wallCol の各成分は WALL_COLOR_MAX 以下なので、色の差は WALL_COLOR_MAX · g(R) ≤ ε。よって left = δ + R。
 * 5. δ · L · WALL_COLOR_MAX ≤ ε（L は g のリプシッツ定数）なら、すべての画素で差は ε 以下なので、どこでも計算しない。
 *
 * 時刻は GPU と同じ f32 に丸めてから引く。GPU の exp と sin の誤差は GPU_MARGIN で見込む。
 */
export function wallWaveBounds(hits: ArrayLike<WallHit>, time: number, out: WallWaveBounds): WallWaveBounds {
  const t = Math.fround(time);
  let sumL = 0;
  let sumR = 0;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const age = t - Math.fround(h.y);
    if (!(age >= 0)) continue;
    const m = Math.abs(Math.fround(h.w)) * Math.exp(-WALL_WAVE.decay * age);
    if (h.z <= 0) sumL += m;
    if (h.z >= 0) sumR += m;
  }
  out.shiftLeft = WALL_WAVE.amp * sumL * GPU_MARGIN;
  out.shiftRight = WALL_WAVE.amp * sumR * GPU_MARGIN;
  out.left = reach(out.shiftLeft);
  out.right = FIELD_W - reach(out.shiftRight);
  return out;
}

/** 壁のずれの上限が delta のとき、壁からどこまで揺れの計算が要るか。要らなければ -FAR */
function reach(delta: number): number {
  if (delta * WALL_GLOW_LIPSCHITZ * WALL_COLOR_MAX <= WALL_WAVE_EPSILON) return -FAR;
  return delta + WALL_GLOW_REACH;
}
