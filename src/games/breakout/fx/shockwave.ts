import type { FxState } from './fx-state.ts';
import { PRESENT_LONG_AGO, SHOCK_SPEED_IDLE } from './fx-state.ts';

/**
 * 背景に広がる衝撃波の輪。ステージクリアの炸裂と、エンドレスの全消しで出す。1 回のプレイごとに作る。
 * 輪は一度に 1 つだけで、新しく出すと前の輪は消える。輪の太さと減衰は描画側（SHOCK_RING）が開始時刻からの経過時間で決める。
 */
export class Shockwave {
  private x = 0;
  private y = 0;
  private start = PRESENT_LONG_AGO;
  private speed = SHOCK_SPEED_IDLE;

  /** present の時刻 now に、(x, y) から速さ speed（u / 秒）で広がる輪を出す */
  fire(now: number, x: number, y: number, speed: number): void {
    this.x = x;
    this.y = y;
    this.start = now;
    this.speed = speed;
  }

  write(fx: FxState): void {
    fx.shockX = this.x;
    fx.shockY = this.y;
    fx.shockStart = this.start;
    fx.shockSpeed = this.speed;
  }
}
