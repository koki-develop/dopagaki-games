import type { CameraRig } from '../../../juice/camera.ts';
import { clamp01, damp } from '../../../shared/math.ts';
import { DANGER_Y } from '../config.ts';
import type { FrameTime } from '../frame-time.ts';
import type { Sim } from '../sim/sim.ts';
import { LOOK } from '../view/look.ts';
import type { FxState } from './fx-state.ts';

/** 演出から動かす BGM のつまみ。Bgm がそのまま当てはまり、値が変わらない呼び出しは Bgm の側で無視する */
export type BgmPort = {
  setTier(tier: number): void;
  setRiser(level: number): void;
  setOpenness(openness: number, seconds: number): void;
  beatPosition(): number;
};

/** ボール数の段階による見た目の変化を、目標の段階へ寄せていく時定数（実時間の秒） */
export const TIER_RISE_TAU = 1.5;
export const TIER_FALL_TAU = 2.0;
/**
 * フラッシュの強さがこれ未満に減ったら 0 にする。
 * 加算で足される光は各成分 1e-4 以下で見分けられないので、消えかけのフラッシュのために全画面を描き続けずに済む。
 */
export const FLASH_EPSILON = 1e-4;
const TWO_PI = Math.PI * 2;

/**
 * 画面全体の空気: ボール数の段階を滑らかにした値、色相の回転、ビート、危険ラインへの迫り、終盤の高まり、
 * フラッシュと bloom のブースト。毎フレーム FxState へ書き、BGM の段階とライザーの今の値を送る。
 */
export class Atmosphere {
  private readonly bgm: BgmPort;
  private readonly initialBreakable: number;
  tierSmooth = 0;
  hue = 0;
  private hueVel = 0;
  private danger = 0;
  private riser = 0;
  private flash = 0;
  private bloomBoost = 0;

  /** initialBreakable はプレイ開始時の壊せるブロックの数（終盤の高まりの基準） */
  constructor(bgm: BgmPort, initialBreakable: number) {
    this.bgm = bgm;
    this.initialBreakable = Math.max(1, initialBreakable);
  }

  /** 画面全体を v の明るさで光らせる。フラッシュリミッターの許可を得てから呼ぶ */
  flashTo(v: number): void {
    this.flash = v;
  }

  /** bloom を一時的に v まで強める（今より強い場合だけ）。フラッシュリミッターの許可を得てから呼ぶ */
  boostTo(v: number): void {
    if (v > this.bloomBoost) this.bloomBoost = v;
  }

  /** 終盤の高まりを消す（ステージクリア）。背景の輝度も戻す */
  resetRiser(): void {
    this.riser = 0;
    this.bgm.setRiser(0);
  }

  /** ライザーの音だけを消す（ゲームオーバー）。背景の輝度はそのまま残す */
  muteRiser(): void {
    this.bgm.setRiser(0);
  }

  /**
   * 1 フレーム進めて fx へ書く。tier はボール数の段階（整数）、intensity は 0〜1。
   * 滑らかにするのは実時間、色相の回転は世界時間で進める。
   */
  update(ft: FrameTime, tier: number, intensity: number, sim: Sim, camera: CameraRig, fx: FxState): void {
    const realDt = ft.realDt;
    // 段階が変わっても、見た目は数秒かけて寄せていく。ボール数は画面に出していないので、切り替わりの瞬間を感じさせない
    this.tierSmooth = damp(this.tierSmooth, tier, tier > this.tierSmooth ? TIER_RISE_TAU : TIER_FALL_TAU, realDt);
    this.bgm.setTier(tier);

    if (tier >= 2) this.hueVel = damp(this.hueVel, 0.3 + (tier - 2) * 0.2, 0.8, realDt);
    else {
      this.hueVel = damp(this.hueVel, 0, 0.6, realDt);
      const target = Math.round(this.hue / TWO_PI) * TWO_PI;
      if (this.hueVel < 0.02) this.hue = damp(this.hue, target, 1.5, realDt);
    }
    this.hue += this.hueVel * ft.worldDt;

    const beatPos = this.bgm.beatPosition();
    const beat = Math.exp(-(beatPos - Math.floor(beatPos)) * 7);
    camera.beatEnvelope = beat;
    camera.beatAmount = this.tierSmooth >= 1.5 ? 0.012 * Math.min(1, this.tierSmooth - 1.5) : 0;

    if (sim.mode.kind === 'endless') {
      const lowest = sim.blocks.lowestLiveBlockBottom();
      const danger = Number.isFinite(lowest) ? clamp01(1 - (lowest - DANGER_Y) / 4) : 0;
      this.danger = damp(this.danger, danger, 0.3, realDt);
    } else if (sim.phase === 'playing') {
      const ratio = sim.blocks.breakableCount / this.initialBreakable;
      const level = ratio < 0.25 ? 1 - ratio / 0.25 : 0;
      this.riser = damp(this.riser, level, 0.25, realDt);
      this.bgm.setRiser(this.riser);
    }

    this.flash *= Math.exp(-realDt * 9);
    if (this.flash < FLASH_EPSILON) this.flash = 0;
    this.bloomBoost *= Math.exp(-realDt * 3.5);

    fx.beat = beat;
    fx.intensity = intensity;
    fx.tier = this.tierSmooth;
    fx.hue = this.hue;
    fx.glow = this.riser * 0.8;
    fx.danger = this.danger;
    fx.flash = this.flash;
    const B = LOOK.bloom;
    fx.bloomStrength = B.base + B.perTier * this.tierSmooth + B.perIntensity * intensity + this.bloomBoost * B.boost;
    fx.bloomRadius = B.radius + B.radiusPerTier * this.tierSmooth;
  }
}
