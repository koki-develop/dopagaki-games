import { FIELD_W } from '../config.ts';
import { LOOK } from './look.ts';
import { GPU_MARGIN, WALL_COLOR_MAX, wallGlow } from './wall-wave.ts';
import type { WallWaveBounds } from './wall-wave.ts';

/**
 * 背景のシェーダーは、壁と天井の光・危険ライン・衝撃波を、色への寄与が見える画素でだけ計算する。
 * 計算を省いた画素で許す、色の各成分（HDR、露出を掛ける前）の誤差の上限を項ごとに決める。
 * 1 つの画素ですべて省いても合計は 8e-5 + 1e-9 で、1e-4 までの残りは、CPU で求めて uniform で渡す値
 * （グリッドの明るさ、下地の色の強さ、衝撃波の弱まり）が、GPU で求めた値と丸めでずれる分に充てる。
 */
export const SKIP_EPSILON = {
  glow: 4e-5,
  farWall: 1e-9,
  danger: 2e-5,
  shock: 2e-5,
} as const;

/**
 * 危険ラインの形。ラインからの距離 d に対して、色 color に
 * `(e^(-sharp·d)·dash + e^(-soft·d)·softGain·danger) · (base + danger²·(pulse·pulseGain + pulseBase)) · endless`
 * を掛ける。dash は破線の 0 か 1、pulse は 0〜1 の脈動。
 */
export const DANGER_LINE = {
  color: [1.0, 0.42, 0.12],
  sharp: 70,
  soft: 8,
  softGain: 0.35,
  base: 0.35,
  pulseGain: 0.9,
  pulseBase: 0.6,
} as const;

/**
 * 衝撃波の輪の形。始まってからの時間 age、輪の前線からの距離 r に対して、
 * `color · LOOK.background.shock · e^(-width·r²) · e^(-decay·age)`（age ≥ 0 のときだけ）。
 */
export const SHOCK_RING = {
  color: [0.7, 0.95, 1.4],
  width: 10,
  decay: 1.4,
} as const;

const SHOCK_PEAK = Math.max(...SHOCK_RING.color) * LOOK.background.shock;

/** 計算しない範囲を表す値。距離は 0 以上なので、これより小さくなることはない */
export const NO_REACH = -1;

/**
 * f(d) ≤ eps となる距離の上側の端を二分法で求める。f は d ≥ 0 で単調に減り、f(hi) ≤ eps であること。
 * 返す値以上の d では必ず f(d) ≤ eps。
 */
function reachOf(f: (d: number) => number, eps: number, hi: number): number {
  let lo = 0;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) <= eps) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * 壁と天井の光を計算する帯の幅。左右の壁の線（x = 0、x = FIELD_W）から壁のずれの上限 + WALL_GLOW_BAND 以上、
 * 天井の線（y = FIELD_H）から WALL_GLOW_BAND 以上離れた画素では計算しない。
 *
 * 左の壁のずれを s、その上限を δ（WallWaveBounds.shiftLeft）とすると、左の壁までの距離は |(x − s, above)| ≥ |x| − δ。
 * 右の壁も同じで、天井までの距離は |y − FIELD_H| 以上。3 つとも WALL_GLOW_BAND 以上なら、光は単調に減るので
 * 各成分は WALL_COLOR_MAX · g(WALL_GLOW_BAND) 以下。揺れを計算した画素でも省いた画素でも |s| ≤ δ なので同じ。
 * GPU の exp と length の誤差を GPU_MARGIN で見込み、それでも SKIP_EPSILON.glow 以下になる距離を選ぶ。
 */
export const WALL_GLOW_BAND = reachOf((d) => WALL_COLOR_MAX * wallGlow(d) * GPU_MARGIN, SKIP_EPSILON.glow, 16);

/**
 * 壁の揺れを、画素に近い側の壁（x < FIELD_W / 2 なら左）の記録だけで計算してよいか。
 *
 * 左半分の画素で右の壁の記録を省いても、左の壁の変位は同じ記録を同じ順に足すので変わらない（省いた記録には
 * step で 0 を掛けていた）。右の壁の変位は記録の一部の和になるが、その大きさも shiftRight / amp 以下なので、
 * 右の壁までの距離は省く前も後も FIELD_W / 2 − shiftRight 以上。光は max(g(dl), g(dr), g(dc)) で、
 * 変わるのは g(dr) だけなので、色の差は WALL_COLOR_MAX · g(FIELD_W / 2 − shiftRight) 以下。右半分も同じ。
 * これが SKIP_EPSILON.farWall 以下なら true。
 */
export function farWallNegligible(b: WallWaveBounds): boolean {
  const d = FIELD_W / 2 - Math.max(b.shiftLeft, b.shiftRight);
  return d > 0 && WALL_COLOR_MAX * wallGlow(d) * GPU_MARGIN <= SKIP_EPSILON.farWall;
}

/**
 * 危険ラインを計算する、ラインからの距離の上限。これ以上離れた画素では計算しない。まったく要らなければ NO_REACH。
 * danger と endless は同じフレームにシェーダーへ渡す値。
 *
 * 色の各成分は 1 以下、破線は 1 以下、脈動は 1 以下なので、距離 d での寄与の各成分は
 * `|endless| · (base + danger²·(pulseGain + pulseBase)) · (e^(-sharp·d) + softGain·|danger|·e^(-soft·d))` 以下。
 * これは d について単調に減るので、GPU_MARGIN を掛けても SKIP_EPSILON.danger 以下になる距離を返す。
 */
export function dangerReach(danger: number, endless: number): number {
  const L = DANGER_LINE;
  const level = Math.abs(endless) * (L.base + danger * danger * (L.pulseGain + L.pulseBase)) * GPU_MARGIN;
  const soft = L.softGain * Math.abs(danger);
  const peak = (d: number) => level * (Math.exp(-L.sharp * d) + soft * Math.exp(-L.soft * d));
  const eps = SKIP_EPSILON.danger;
  if (!(peak(0) > eps)) return NO_REACH;
  let hi = 1;
  while (peak(hi) > eps) hi *= 2;
  return reachOf(peak, eps, hi);
}

/** 衝撃波が始まってからの時間。GPU と同じく、f32 に丸めた 2 つの時刻の差を f32 に丸めて求める */
export const shockAge = (time: number, start: number): number => Math.fround(Math.fround(time) - Math.fround(start));

/**
 * 衝撃波を計算する、輪の前線からの距離の上限。これ以上離れた画素では計算しない。まったく要らなければ NO_REACH。
 * time と start は同じフレームにシェーダーへ渡す時刻と衝撃波の開始時刻。
 *
 * age < 0 なら寄与はちょうど 0。age ≥ 0 なら、前線から r 離れた画素の寄与の各成分は
 * `a · e^(-width·r²)`（a = max(color) · shock · e^(-decay·age)）以下なので、
 * GPU_MARGIN を掛けて a · e^(-width·r²) = SKIP_EPSILON.shock となる r を返す。a がすでに ε 以下なら計算しない。
 */
export function shockReach(time: number, start: number): number {
  const age = shockAge(time, start);
  if (!(age >= 0)) return NO_REACH;
  const S = SHOCK_RING;
  const peak = SHOCK_PEAK * Math.exp(-S.decay * age) * GPU_MARGIN;
  const eps = SKIP_EPSILON.shock;
  if (!(peak > eps)) return NO_REACH;
  return Math.sqrt(Math.log(peak / eps) / S.width);
}
