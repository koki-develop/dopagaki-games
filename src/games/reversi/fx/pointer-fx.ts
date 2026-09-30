import type { FrameTime } from '../../../juice/frame-time.ts';
import { POINTER_RATE } from '../config.ts';
import { cellX, cellY } from '../geometry.ts';
import type { Color } from '../rules/position.ts';
import { RIM_HUE } from '../view/palette.ts';
import { NO_FLIPS } from './choreo.ts';
import type { PreviewFlip } from './choreo.ts';
import type { DiscField } from './discs.ts';
import type { FxState } from './fx-state.ts';

type PointerFxDeps = {
  discs: Pick<DiscField, 'preview'>;
  /** 人の色（予告の石と印の色） */
  human: Color;
};

/**
 * 盤の上の指し示し: 押している・ホバーしているマス（打てるなら半透明の石と、返る石の震え）と、キーボードのカーソル。
 * FxState の cursor〜・hover〜・markerHue を書くのはここだけ。光の強さは実時間で滑らかに寄せる。
 */
export class PointerFx {
  private readonly d: PointerFxDeps;
  /** 人が押している・ホバーしているマス（-1 はなし）と、打てるマスか */
  private pointerSquare = -1;
  private pointerLegal = false;
  private hoverStrength = 0;
  private cursorSquare = -1;
  private cursorStrength = 0;

  constructor(deps: PointerFxDeps, fx: FxState) {
    this.d = deps;
    fx.markerHue = RIM_HUE[deps.human];
  }

  /** 押している・ホバーしているマス。legal なら半透明の石を置き、返る石を震わせる（flips）。square が -1 なら消す */
  setPointer(square: number, legal: boolean, flips: readonly PreviewFlip[], present: number): void {
    if (square === this.pointerSquare && legal === this.pointerLegal) return;
    this.pointerSquare = square;
    this.pointerLegal = legal;
    this.d.discs.preview(legal ? square : -1, this.d.human, legal ? flips : NO_FLIPS, present);
  }

  /** 押している・ホバーしているマスの予告を消す */
  clearPointer(present: number): void {
    this.setPointer(-1, false, NO_FLIPS, present);
  }

  /** キーボードのカーソルのマス（-1 は出さない） */
  setCursor(square: number): void {
    this.cursorSquare = square;
  }

  update(ft: FrameTime, fx: FxState): void {
    const square = this.pointerSquare;
    const k = Math.min(1, ft.realDt * POINTER_RATE);
    this.hoverStrength += ((square >= 0 ? 1 : 0) - this.hoverStrength) * k;
    if (square >= 0) {
      fx.hoverX = cellX(square);
      fx.hoverY = cellY(square);
      fx.hoverLegal = this.pointerLegal ? 1 : 0;
    }
    fx.hover = this.hoverStrength;
    this.cursorStrength += ((this.cursorSquare >= 0 ? 1 : 0) - this.cursorStrength) * k;
    if (this.cursorSquare >= 0) {
      fx.cursorX = cellX(this.cursorSquare);
      fx.cursorY = cellY(this.cursorSquare);
    }
    fx.cursor = this.cursorStrength;
  }
}
