import type { FlashLimiter } from '../../../juice/flash.ts';
import type { FrameTime } from '../../../juice/frame-time.ts';
import { clamp01, damp } from '../../../shared/math.ts';
import { AIR } from '../config.ts';
import { BGM_TOP_TIER } from '../sounds/bgm.ts';
import type { Side } from '../types.ts';
import { LOOK } from '../view/look.ts';
import { LONG_AGO } from './discs.ts';
import type { FxState } from './fx-state.ts';

/** 演出から動かす BGM のつまみ。LayeredBgm がそのまま当てはまり、値が変わらない呼び出しは LayeredBgm の側で無視する */
export type BgmPort = {
  setTier(tier: number): void;
  setRiser(level: number): void;
  beatPosition(): number;
};

/**
 * フラッシュの強さがこれ未満に減ったら 0 にする。
 * 加算で足される光は各成分 1e-4 以下で見分けられないので、消えかけのフラッシュのために全画面を描き続けずに済む。
 */
const FLASH_EPSILON = 1e-4;
/** 虹色の回った量を折り返す周期（周）。盤（1 倍）と背景（2/3 倍）のどちらの色相も、ちょうど整数周になる */
const RAINBOW_WRAP = 3;

/**
 * 画面全体の空気: 演出の強さ、手番の色、CPU の重い手の暗さ、放射状の光、虹色、フラッシュ、bloom のブースト、
 * フィーバー（コンボ中だけ光をビートに乗せる）、ヒットストップの震え・集中線・RGB のずれ。
 * FxState の beat 〜 dread と bloomStrength を書くのはここだけ。BGM の段階とライザーの今の値も送る。カメラはビートで動かさない。
 * 目標の値は演出が与え、ここで滑らかに寄せる（滑らかにするのと、ヒットストップの間も動くものは実時間）。
 * 画面全体の明滅と bloom のブーストは flare だけが出し、1 回の光ごとに FlashLimiter の許可を 1 回だけ得る。
 */
export class Atmosphere {
  private readonly bgm: BgmPort;
  private readonly flashes: Pick<FlashLimiter, 'request'>;
  /** 手番の色の目標（1 で人、0 で CPU） */
  private turnTarget = 1;
  private turnTint = 1;
  private intensity = 0;
  private intensityTarget = 0;
  private dread = 0;
  private rays = 0;
  private rainbow = 0;
  private rainbowTurns = 0;
  private flash = 0;
  private bloomBoost = 0;
  private glow = 0;
  private hue = 0;
  /** BGM の段階の目標（盤の石の数から）と、終盤の高まり（0〜1） */
  private tier = 0;
  private riser = 0;
  private riserOn = true;
  /** フィーバーの強さ（0〜1）。BGM の段階を上げ、光をビートに乗せる */
  private fever = 0;
  private feverShown = 0;
  /** ヒットストップの震え: 中心、強さ、始めた実時間、長さ */
  private hitX = 0;
  private hitY = 0;
  private hitAmp = 0;
  private hitAt = 0;
  private hitDur = 0;
  /** 集中線: 中心、始めた実時間、強さ */
  private impactX = 0;
  private impactY = 0;
  private impactAt = LONG_AGO;
  private impactStrength = 0;
  /** RGB のずれ: 量（画面の幅に対する割合）と向き */
  private aberration = 0;
  private aberrationAngle = 0;

  constructor(bgm: BgmPort, flashes: Pick<FlashLimiter, 'request'>) {
    this.bgm = bgm;
    this.flashes = flashes;
  }

  /**
   * 1 回の光。画面全体を flash の明るさで光らせ、bloom を boost まで強める（どちらも今より強い場合だけ、0 なら出さない）。
   * 実時間 real に FlashLimiter の許可を 1 回だけ求め、許可されなければどちらも出さない。出したら true
   */
  flare(real: number, flash: number, boost: number): boolean {
    if (flash <= 0 && boost <= 0) return false;
    if (!this.flashes.request(real)) return false;
    if (flash > this.flash) this.flash = flash;
    if (boost > this.bloomBoost) this.bloomBoost = boost;
    return true;
  }

  /** 演出の強さを v（0〜1）まで上げる。時間とともに下がっていく */
  kick(v: number): void {
    if (v > this.intensityTarget) this.intensityTarget = v;
  }

  /** CPU の重い手の暗さを v まで上げる */
  darken(v: number): void {
    if (v > this.dread) this.dread = v;
  }

  /** 放射状の光を v まで広げる */
  spreadRays(v: number): void {
    if (v > this.rays) this.rays = v;
  }

  /** 盤の線を虹色に回す（段階 4 の手、最高スコアの更新、勝ちの締めの波、パーフェクト） */
  prism(v: number): void {
    if (v > this.rainbow) this.rainbow = v;
  }

  /** フィーバーの強さ（0〜1）。コンボから決める */
  setFever(level: number): void {
    this.fever = level;
  }

  /** 次に打つ側。盤と背景の色をその側へ寄せる */
  setTurn(side: Side): void {
    this.turnTarget = side === 'human' ? 1 : 0;
  }

  /**
   * ヒットストップ: (x, y) で止めた石を、実時間 real から duration 秒、amp の強さで横に震わせる。
   * 震えは初めが大きく、だんだん小さくする。同時に集中線と RGB のずれを出す
   */
  hitStop(x: number, y: number, amp: number, duration: number, real: number): void {
    this.hitX = x;
    this.hitY = y;
    this.hitAmp = amp;
    this.hitAt = real;
    this.hitDur = duration;
    this.impactX = x;
    this.impactY = y;
    this.impactAt = real;
    this.impactStrength = Math.min(1, AIR.impact.base + amp);
    this.aberration = Math.max(this.aberration, AIR.aberration.base + AIR.aberration.perAmp * amp);
    this.aberrationAngle = real * AIR.aberration.angleRate;
  }

  /** 盤に置かれた石の数と空きマスから、BGM の段階と終盤の高まりを決める */
  setProgress(tier: number, empties: number): void {
    this.tier = tier;
    this.riser = empties <= AIR.riserEmpties ? 1 - empties / AIR.riserEmpties : 0;
  }

  /** 終盤の高まりを止める（終局） */
  muteRiser(): void {
    this.riserOn = false;
    this.bgm.setRiser(0);
  }

  update(ft: FrameTime, fx: FxState): void {
    const dt = ft.realDt;
    const decay = AIR.decay;
    this.turnTint = damp(this.turnTint, this.turnTarget, AIR.turnTau, dt);
    this.intensityTarget = Math.max(0, this.intensityTarget - dt * AIR.intensity.fall);
    this.intensity = damp(this.intensity, this.intensityTarget, this.intensityTarget > this.intensity ? AIR.intensity.riseTau : AIR.intensity.fallTau, dt);
    this.dread *= Math.exp(-dt * decay.dread);
    this.rays *= Math.exp(-dt * decay.rays);
    this.rainbow *= Math.exp(-dt * decay.rainbow);
    this.rainbowTurns = (this.rainbowTurns + dt * AIR.rainbowTurnsPerSecond * this.rainbow) % RAINBOW_WRAP;
    this.flash *= Math.exp(-dt * decay.flash);
    if (this.flash < FLASH_EPSILON) this.flash = 0;
    this.bloomBoost *= Math.exp(-dt * decay.boost);
    this.glow = damp(this.glow, this.riser * LOOK.background.riserGlow, AIR.glowTau, dt);
    this.hue += ft.worldDt * (AIR.hue.base + this.intensity * AIR.hue.perIntensity);
    this.feverShown = damp(this.feverShown, this.fever, AIR.feverTau, dt);
    this.aberration *= Math.exp(-dt * decay.aberration);
    if (this.aberration < 1e-4) this.aberration = 0;

    this.bgm.setTier(Math.min(BGM_TOP_TIER, this.tier + (this.fever > 0 ? 1 : 0) + (this.fever >= 1 ? 1 : 0)));
    if (this.riserOn) this.bgm.setRiser(this.riser * AIR.riserBgm);

    const beatPos = this.bgm.beatPosition();
    const beat = Math.exp(-(beatPos - Math.floor(beatPos)) * AIR.beatSharpness);

    fx.beat = beat * this.feverShown;
    fx.fever = this.feverShown;
    const hitK = this.hitDur > 0 ? clamp01(1 - (ft.real - this.hitAt) / this.hitDur) : 0;
    fx.hitX = this.hitX;
    fx.hitY = this.hitY;
    fx.hitShake = this.hitAmp * hitK * hitK;
    fx.impactX = this.impactX;
    fx.impactY = this.impactY;
    fx.impactAt = this.impactAt;
    fx.impactStrength = this.impactStrength;
    fx.aberration = this.aberration;
    fx.aberrationAngle = this.aberrationAngle;
    fx.intensity = clamp01(this.intensity);
    fx.hue = this.hue;
    fx.glow = this.glow;
    fx.flash = this.flash;
    fx.turnTint = this.turnTint;
    fx.dread = clamp01(this.dread);
    fx.rays = clamp01(this.rays);
    fx.rainbow = clamp01(this.rainbow);
    fx.rainbowTurns = this.rainbowTurns;
    const B = LOOK.bloom;
    fx.bloomStrength = B.base + B.perIntensity * this.intensity + this.bloomBoost * B.boost;
  }
}
