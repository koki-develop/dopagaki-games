import { Air } from '../../../juice/air.ts';
import type { AirBgm, AirTuning } from '../../../juice/air.ts';
import type { FlashLimiter } from '../../../juice/flash.ts';
import type { FrameTime } from '../../../juice/frame-time.ts';
import { damp } from '../../../shared/math.ts';
import { AIR } from '../config.ts';
import { BGM_TOP_TIER } from '../sounds/bgm.ts';
import type { Side } from '../types.ts';
import { LOOK } from '../view/look.ts';
import type { FxState } from './fx-state.ts';

/** 演出から動かす BGM のつまみ */
export type BgmPort = AirBgm;

const TUNING: AirTuning = { ...AIR, bgmTopTier: BGM_TOP_TIER, riser: { bgm: AIR.riserBgm, glow: LOOK.background.riserGlow }, bloom: LOOK.bloom };

/**
 * 画面全体の空気。共通の部品（juice/air.ts の Air）に、リバーシの手番の色（盤と背景の色をその側へ寄せる）と、
 * ヒットストップで止めた石を震わせる中心を足す。
 * FxState の beat 〜 dread と bloomStrength を書くのはここだけ。BGM の段階とライザーの今の値も送る。
 * BGM の段階は盤の石の数から決め、終盤の高まりは空きマスから決める。
 */
export class Atmosphere {
  private readonly air: Air;
  /** 手番の色の目標（1 で人、0 で CPU） */
  private turnTarget = 1;
  private turnTint = 1;
  /** ヒットストップで止めた石を震わせる中心 */
  private hitX = 0;
  private hitY = 0;

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

  /** CPU の重い手の暗さを v まで上げる */
  darken(v: number): void {
    this.air.darken(v);
  }

  /** 放射状の光を v まで広げる */
  spreadRays(v: number): void {
    this.air.spreadRays(v);
  }

  /** 盤の線を虹色に回す（段階 4 の手、最高スコアの更新、勝ちの締めの波、パーフェクト） */
  prism(v: number): void {
    this.air.prism(v);
  }

  /** フィーバーの強さ（0〜1）。コンボから決める */
  setFever(level: number): void {
    this.air.setFever(level);
  }

  /** 次に打つ側。盤と背景の色をその側へ寄せる */
  setTurn(side: Side): void {
    this.turnTarget = side === 'human' ? 1 : 0;
  }

  /** ヒットストップ: (x, y) で止めた石を、実時間 real から duration 秒、amp の強さで震わせる。集中線と RGB のずれも出す */
  hitStop(x: number, y: number, amp: number, duration: number, real: number): void {
    this.hitX = x;
    this.hitY = y;
    this.air.hitStop(x, y, amp, duration, real);
  }

  /** 盤に置かれた石の数と空きマスから、BGM の段階と終盤の高まりを決める */
  setProgress(tier: number, empties: number): void {
    this.air.setProgress(tier, empties <= AIR.riserEmpties ? 1 - empties / AIR.riserEmpties : 0);
  }

  /** 終盤の高まりを止める（終局） */
  muteRiser(): void {
    this.air.muteRiser();
  }

  update(ft: FrameTime, fx: FxState): void {
    this.turnTint = damp(this.turnTint, this.turnTarget, AIR.turnTau, ft.realDt);
    this.air.update(ft, fx);
    fx.hitX = this.hitX;
    fx.hitY = this.hitY;
    fx.turnTint = this.turnTint;
  }
}
