import type { CameraRig } from '../../../juice/camera.ts';
import type { FlashLimiter } from '../../../juice/flash.ts';
import type { FrameTime } from '../../../juice/frame-time.ts';
import type { Atmosphere } from './atmosphere.ts';
import type { ParticleFx } from './particle-fx.ts';
import type { Shockwave } from './shockwave.ts';
import type { SfxPort } from './sound-director.ts';

/** 全消しの衝撃波の速さ（u / 秒）。フィナーレの炸裂より少し遅く広げる */
export const ALL_CLEAR_SHOCK_SPEED = 12;
/** 全消しで bloom を強める量。Peak（1.1）とフィナーレ（1.4）より控えめ */
const ALL_CLEAR_BOOST = 0.9;

export type AllClearDeps = {
  camera: CameraRig;
  sfx: SfxPort;
  particles: ParticleFx;
  shockwave: Shockwave;
  flashes: FlashLimiter;
  atmosphere: Atmosphere;
};

/**
 * エンドレスの全消しの演出。最後に壊したブロックの中心 (x, y) から衝撃波の輪と火花を広げ、和音を鳴らし、カメラを揺らして小さく引く。
 * 引きは揺れの一部（CameraRig.punch）なので、画面の揺れをオフにすると止まる。
 * bloom の強調はフラッシュリミッターが許可したときだけ。
 */
export function playAllClear(ft: FrameTime, x: number, y: number, budget: number, d: AllClearDeps): void {
  d.shockwave.fire(ft.present, x, y, ALL_CLEAR_SHOCK_SPEED);
  d.particles.allClearBurst(ft.present, x, y, budget);
  d.sfx.allClear();
  d.camera.addTrauma(0.35);
  d.camera.punch(0.05, 0.1, 0.45);
  if (d.flashes.request(ft.real)) d.atmosphere.boostTo(ALL_CLEAR_BOOST);
}
