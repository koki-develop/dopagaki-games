import type { CameraRig } from '../../../juice/camera.ts';
import type { FrameTime } from '../../../juice/frame-time.ts';
import type { WorldClock } from '../../../juice/time.ts';
import type { Sim } from '../sim/sim.ts';
import type { Atmosphere, BgmPort } from './atmosphere.ts';
import type { ParticleFx } from './particle-fx.ts';
import type { SfxPort } from './sound-director.ts';

/** ゲームオーバーから結果画面へ移るまで（実時間の秒） */
export const GAME_OVER_FINISH = 1.4;
/** ゲームオーバーの世界の時間の倍率。戻さずにこのまま止まっていく */
const GAME_OVER_SLOW = 0.12;
/** 燃え尽きる光を出すボールの数の上限（品質の倍率を掛ける前） */
const MAX_BURNOUT_FX = 160;

type GameOverDeps = {
  sim: Sim;
  clock: WorldClock;
  camera: CameraRig;
  sfx: SfxPort;
  bgm: BgmPort;
  atmosphere: Atmosphere;
  particles: ParticleFx;
};

/**
 * ゲームオーバーの演出。世界をスローにして止めていき、残っているボールを 1 個ずつ暗い光にして燃え尽きさせる。
 * 残ったブロックは画面に残したまま、GAME_OVER_FINISH 秒（実時間）で結果画面へ移る。
 */
export class GameOver {
  private readonly d: GameOverDeps;
  private startReal = -1;
  private finished = false;
  private burnNow = 0;
  private burnFx = 0;
  private burnLimit = 0;
  private readonly all = (): boolean => true;
  private readonly burn = (x: number, y: number): void => {
    if (this.burnFx++ >= this.burnLimit) return;
    this.d.particles.burnOut(this.burnNow, x, y);
  };

  constructor(deps: GameOverDeps) {
    this.d = deps;
  }

  get started(): boolean {
    return this.startReal >= 0;
  }

  start(ft: FrameTime, budget: number): void {
    if (this.started) return;
    const d = this.d;
    this.startReal = ft.real;
    d.clock.slowMo(GAME_OVER_SLOW, 1.1, Infinity);
    d.sfx.gameOver();
    d.bgm.setOpenness(0.08, 1.4);
    d.atmosphere.muteRiser();
    d.camera.pull(0.05, 0.3, 1.2);
    this.burnNow = ft.present;
    this.burnFx = 0;
    this.burnLimit = Math.ceil(MAX_BURNOUT_FX * budget);
    d.sim.collectBalls(this.all, this.burn);
  }

  /** 結果画面へ移るフレームで 1 回だけ true を返す */
  update(ft: FrameTime): boolean {
    if (!this.started || this.finished || ft.real - this.startReal < GAME_OVER_FINISH) return false;
    this.finished = true;
    return true;
  }
}
