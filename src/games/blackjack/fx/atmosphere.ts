import { Air } from '../../../juice/air.ts';
import type { AirBgm, AirTuning } from '../../../juice/air.ts';
import type { FlashLimiter } from '../../../juice/flash.ts';
import type { FrameTime } from '../../../juice/frame-time.ts';
import { clamp01, damp } from '../../../shared/math.ts';
import { AIR } from '../config.ts';
import { LOOK } from '../view/look.ts';
import type { FxState } from './fx-state.ts';

/** 演出から動かす BGM のつまみ */
export type BgmPort = AirBgm;

/** BGM はプレイの間ずっと同じ編成で鳴らすので、段階を上げず（フィーバーでも変えない）、終盤の高まり（BGM のライザー）も使わない */
const TUNING: AirTuning = { ...AIR, bgmTopTier: 0, riser: null, bloom: LOOK.bloom };

/**
 * 画面全体の空気。共通の部品（juice/air.ts の Air）に、ブラックジャックの溜めの絞り込み（画面の縁からカードへ向かって暗くする）を足す。
 * FxState の beat 〜 dread、bloomStrength、focus〜 を書くのはここだけ。
 */
export class Atmosphere {
  private readonly air: Air;
  /** 溜めの絞り込みの目標と今の値、絞り込む先 */
  private focusTarget = 0;
  private focus = 0;
  private focusX = 0;
  private focusY = 0;

  constructor(bgm: BgmPort, flashes: Pick<FlashLimiter, 'request'>) {
    this.air = new Air(TUNING, bgm, flashes);
  }

  /** 1 回の光（Air.flare）。出したら true */
  flare(real: number, flash: number, boost: number): boolean {
    return this.air.flare(real, flash, boost);
  }

  /** 演出の強さを v（0〜1）まで上げる */
  kick(v: number): void {
    this.air.kick(v);
  }

  /** 負けの暗さを v まで上げる */
  darken(v: number): void {
    this.air.darken(v);
  }

  /** 放射状の光を v まで広げる */
  spreadRays(v: number): void {
    this.air.spreadRays(v);
  }

  /** 卓の線を虹色に回す */
  prism(v: number): void {
    this.air.prism(v);
  }

  /** フィーバーの強さ（0〜1）。連勝から決める */
  setFever(level: number): void {
    this.air.setFever(level);
  }

  /** ヒットストップ: 実時間 real から duration 秒、amp の強さでカードとチップを震わせる。(x, y) へ集中線と RGB のずれも出す */
  hitStop(x: number, y: number, amp: number, duration: number, real: number): void {
    this.air.hitStop(x, y, amp, duration, real);
  }

  /** 溜め: (x, y) へ向かって画面の縁から strength（0〜1）まで絞り込む。0 で戻す */
  setFocus(strength: number, x: number, y: number): void {
    this.focusTarget = strength;
    if (strength > 0) {
      this.focusX = x;
      this.focusY = y;
    }
  }


  update(ft: FrameTime, fx: FxState): void {
    this.air.update(ft, fx);
    this.focus = damp(this.focus, this.focusTarget, AIR.focusTau, ft.realDt);
    if (this.focusTarget === 0 && this.focus < 1e-3) this.focus = 0;
    fx.focus = clamp01(this.focus);
    fx.focusX = this.focusX;
    fx.focusY = this.focusY;
  }
}
