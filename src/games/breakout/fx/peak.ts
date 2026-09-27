import type { CameraRig } from '../../../juice/camera.ts';
import type { FlashLimiter } from '../../../juice/flash.ts';
import type { Atmosphere } from './atmosphere.ts';
import type { SfxPort } from './sound-director.ts';

/** 自己ベストを超えた瞬間の Peak の強さ */
export const NEW_BEST_PEAK_LEVEL = 3;

export type PeakDeps = {
  camera: CameraRig;
  sfx: SfxPort;
  flashes: FlashLimiter;
  atmosphere: Atmosphere;
  vibrate(pattern: number | readonly number[]): void;
};

/**
 * 自己ベスト。HUD の NEW!、結果画面の NEW BEST!、Peak の演出は、すべてここで決める。
 * - 新記録（HUD の NEW! と結果画面の NEW BEST!）: スコアが前のベストを上回っていれば、いつでも。記録がない初回も含む
 * - Peak の演出: 前のベストが 0 より大きいときに、プレイ中に超えた瞬間の 1 回だけ。
 *   記録がない初回は、最初の得点で必ず超えてしまうので出さない。決着の後のボーナスで超えたときはフィナーレが代わりになる
 */
export class NewBest {
  private readonly previousBest: number;
  private fired = false;

  constructor(previousBest: number) {
    this.previousBest = previousBest;
  }

  isNewBest(score: number): boolean {
    return score > this.previousBest;
  }

  /** Peak を出すべきフレームなら true。1 プレイで 1 回だけ */
  check(score: number, playing: boolean): boolean {
    if (this.fired || !playing || this.previousBest <= 0 || !this.isNewBest(score)) return false;
    this.fired = true;
    return true;
  }
}

/** Peak の共通演出: カメラを引いてから戻す、専用の和音、trauma、bloom のブースト、振動。real は実時間の秒 */
export function playPeak(level: number, real: number, d: PeakDeps): void {
  d.camera.pull(0.07 + level * 0.012, 0.14, 0.75);
  d.camera.addTrauma(0.6);
  d.sfx.peakChord(level);
  if (d.flashes.request(real)) d.atmosphere.boostTo(0.8 + level * 0.1);
  d.vibrate(45);
}
