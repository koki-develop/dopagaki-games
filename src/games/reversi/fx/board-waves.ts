import { RIPPLE, SHOCKWAVE } from '../config.ts';
import type { FxState } from './fx-state.ts';

/**
 * 盤の波紋と、背景を走る衝撃波。FxState の ripples と shockwaves を書くのはここだけ。
 * どちらも決まった数の枠を順に使い、埋まったら古いものから上書きする。時刻は present の時間軸。
 */
export class BoardWaves {
  private readonly ripples: Float32Array;
  private readonly shockwaves: Float32Array;
  private rippleSlot = 0;
  private shockSlot = 0;

  constructor(fx: FxState) {
    this.ripples = fx.ripples;
    this.shockwaves = fx.shockwaves;
  }

  /** 時刻 at に (x, y) から強さ strength の波紋を広げる */
  ripple(at: number, x: number, y: number, strength: number): void {
    write(this.ripples, this.rippleSlot, x, y, at, strength);
    this.rippleSlot = (this.rippleSlot + 1) % RIPPLE.slots;
  }

  /** 時刻 at に (x, y) から速さ speed（u / 秒）の衝撃波を放つ */
  shockwave(at: number, x: number, y: number, speed: number): void {
    write(this.shockwaves, this.shockSlot, x, y, at, speed);
    this.shockSlot = (this.shockSlot + 1) % SHOCKWAVE.slots;
  }
}

function write(out: Float32Array, slot: number, x: number, y: number, at: number, w: number): void {
  const o = slot * 4;
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = at;
  out[o + 3] = w;
}
