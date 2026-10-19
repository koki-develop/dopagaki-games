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

/** Peak の共通演出: カメラを引いてから戻す、専用の和音、trauma、bloom のブースト、振動。real は実時間の秒 */
export function playPeak(level: number, real: number, d: PeakDeps): void {
  d.camera.pull(0.07 + level * 0.012, 0.14, 0.75);
  d.camera.addTrauma(0.6);
  d.sfx.peakChord(level);
  if (d.flashes.request(real)) d.atmosphere.boostTo(0.8 + level * 0.1);
  d.vibrate(45);
}
