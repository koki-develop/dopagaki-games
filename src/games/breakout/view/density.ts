import { FIELD_H, FIELD_W } from '../config.ts';

export const DENSITY_W = 18;
export const DENSITY_H = 32;

/** 背景のグリッドが密度で歪み始める段階と、歪みが最大になる段階 */
export const WARP_TIER_START = 2.4;
export const WARP_TIER_FULL = 3.4;

/**
 * 背景のシェーダーが密度テクスチャを読むか。シェーダーは f32 の u.tier と f32 の定数を比べるので、
 * 同じく f32 に丸めて比べ、GPU と判定を揃える。
 */
export const isWarpActive = (tier: number): boolean => Math.fround(tier) > Math.fround(WARP_TIER_START);

/** 1 フレームごとに前の密度に掛ける減衰 */
const DECAY = 0.82;
/** ボール 1 個がセルに足す密度 */
const SPLAT = 0.05;

/**
 * ボールの密度の格子。フィールドを DENSITY_W × DENSITY_H のセルに分け、前のフレームと混ぜて滑らかにする。
 * data はテクスチャへ送る 0〜255 の値。前に送ってから data が変わったかを覚えておき、
 * 読まれるときだけ送り直せるようにする。
 */
export class DensityGrid {
  readonly data = new Uint8Array(DENSITY_W * DENSITY_H);
  private readonly accum = new Float32Array(DENSITY_W * DENSITY_H);
  /** 最後に送ってから data が変わったか */
  private changed = false;

  /** 1 フレーム分、前の密度を減らしてボールの位置を足す */
  accumulate(xs: ArrayLike<number>, ys: ArrayLike<number>, count: number): void {
    const acc = this.accum;
    for (let i = 0; i < acc.length; i++) acc[i] *= DECAY;
    const sx = DENSITY_W / FIELD_W;
    const sy = DENSITY_H / FIELD_H;
    for (let i = 0; i < count; i++) {
      const cx = Math.floor(xs[i] * sx);
      const cy = Math.floor(ys[i] * sy);
      if (cx < 0 || cx >= DENSITY_W || cy < 0 || cy >= DENSITY_H) continue;
      acc[cy * DENSITY_W + cx] += SPLAT;
    }
    const d = this.data;
    let changed = false;
    for (let i = 0; i < acc.length; i++) {
      const v = Math.min(255, acc[i] * 255) | 0;
      if (d[i] !== v) {
        d[i] = v;
        changed = true;
      }
    }
    if (changed) this.changed = true;
  }

  /** 密度の記録を消す */
  reset(): void {
    this.accum.fill(0);
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] !== 0) {
        this.changed = true;
        break;
      }
    }
    this.data.fill(0);
  }

  /**
   * テクスチャを送り直すべきなら true を返し、送ったものとして記録する。
   * 読まれていない（read が false）間は送らず、変化を覚えたままにしておく。
   */
  takeUpload(read: boolean): boolean {
    if (!read || !this.changed) return false;
    this.changed = false;
    return true;
  }
}
