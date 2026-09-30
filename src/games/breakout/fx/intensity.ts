import { EventRate } from '../../../juice/rate.ts';
import { clamp01 } from '../../../shared/math.ts';

/** 破壊ペースの平滑化の時定数（秒） */
const RATE_TAU = 0.35;
/** intensity が 1 になる破壊ペース（個 / 秒） */
const RATE_MAX = 250;
/** intensity が 1 になる chain 数 */
const CHAIN_MAX = 200;

/**
 * 破壊ペース（1 秒あたりの破壊数）を指数的に平滑化して測る。
 * 1 秒に 1 個から数百個まで幅が広いので、intensity は log スケールで 0〜1 に正規化する。
 */
export class IntensityMeter {
  private readonly breakRate = new EventRate(RATE_TAU);
  intensity = 0;

  /** dt 秒の間の破壊数と、今の chain 数を渡す。dt が 0 のフレーム（世界の時間が止まっている間）では何も変えない */
  update(breaks: number, chain: number, dt: number): void {
    if (dt <= 0) return;
    const r = Math.log1p(this.breakRate.update(breaks, dt)) / Math.log1p(RATE_MAX);
    const c = Math.log1p(chain) / Math.log1p(CHAIN_MAX);
    this.intensity = clamp01(0.75 * r + 0.25 * c);
  }
}
