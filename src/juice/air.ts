import { clamp01, damp } from '../shared/math.ts';
import type { FlashLimiter } from './flash.ts';
import type { FrameTime } from './frame-time.ts';
import { PRESENT_LONG_AGO } from './frame-time.ts';

/** 空気から動かす BGM のつまみ。LayeredBgm がそのまま当てはまり、値が変わらない呼び出しは LayeredBgm の側で無視する */
export type AirBgm = {
  setTier(tier: number): void;
  setRiser(level: number): void;
  beatPosition(): number;
};

/**
 * 空気の動きの調整値。時間はすべて実時間の秒。〜Tau は滑らかに寄せる時定数（秒）、decay は減衰の速さ（1/秒）
 */
export type AirTuning = {
  readonly feverTau: number;
  readonly glowTau: number;
  /** 演出の強さの目標は 1 秒あたり fall ずつ下がり、今の値は上がるときに riseTau、下がるときに fallTau で寄せる */
  readonly intensity: { readonly fall: number; readonly riseTau: number; readonly fallTau: number };
  readonly decay: { readonly dread: number; readonly rays: number; readonly rainbow: number; readonly flash: number; readonly boost: number; readonly aberration: number };
  /** 背景の色相が 1 秒（世界時間）に回る量（周） */
  readonly hue: { readonly base: number; readonly perIntensity: number };
  /** ビートの直後の光の立ち下がりの鋭さ */
  readonly beatSharpness: number;
  /** ヒットストップの RGB のずれ（画面の幅に対する割合、amp はヒットストップの強さ）。向きは実時間 × angleRate（ラジアン）で毎回変える */
  readonly aberration: { readonly base: number; readonly perAmp: number; readonly angleRate: number };
  /** ヒットストップの集中線の強さ: base + amp */
  readonly impact: { readonly base: number };
  /** 虹色の強さ 1 のときに、線の色相が 1 秒で回る量（周） */
  readonly rainbowTurnsPerSecond: number;
  /** BGM のいちばん上の段階 */
  readonly bgmTopTier: number;
  /**
   * 終盤の高まり（setProgress の riser）の掛け方: BGM のライザーに渡す割合（bgm）と、高まり 1 のときの背景の中心の光の上乗せ（glow）。
   * null のゲームは終盤の高まりを使わず、BGM のライザーを使い始めない（全体のフィルタもライザーの基準にこもらせない）
   */
  readonly riser: { readonly bgm: number; readonly glow: number } | null;
  /** bloom: 何も起きていないときの強さ、演出の強さ 1 あたりの上乗せ、一時的なブーストに掛ける倍率 */
  readonly bloom: { readonly base: number; readonly perIntensity: number; readonly boost: number };
};

/** 空気が毎フレーム書く値。各ゲームの演出の状態（FxState）がこの形を含む */
export type AirFrame = {
  /** ビートの直後に 1 になって減衰する値。フィーバーの強さを掛けてあり、フィーバーでなければ 0 */
  beat: number;
  /** フィーバーの強さ（0〜1） */
  fever: number;
  /** ヒットストップで止めた物を震わせる強さ（0 で震えない） */
  hitShake: number;
  /** 集中線の中心、始めた実時間、強さ（0〜1） */
  impactX: number;
  impactY: number;
  impactAt: number;
  impactStrength: number;
  /** RGB のずれの量（画面の幅に対する割合）と向き（ラジアン） */
  aberration: number;
  aberrationAngle: number;
  /** 0〜1 の演出の強さ */
  intensity: number;
  /** 背景の色相のずれ（0〜1 で 1 周） */
  hue: number;
  /** 背景の明るさの上乗せ（終盤の高まり） */
  glow: number;
  /** 画面全体のフラッシュの強さ。見えないほど小さくなったら 0 にする */
  flash: number;
  /** 背景の放射状の光の強さ（0〜1） */
  rays: number;
  /** 線の色が虹色に回る強さ（0〜1）と、回った量（周） */
  rainbow: number;
  rainbowTurns: number;
  /** 負けの暗さ（0〜1） */
  dread: number;
  bloomStrength: number;
};

/**
 * フラッシュの強さがこれ未満に減ったら 0 にする。
 * 加算で足される光は各成分 1e-4 以下で見分けられないので、消えかけのフラッシュのために全画面を描き続けずに済む。
 */
const FLASH_EPSILON = 1e-4;
/** 虹色の回った量を折り返す周期（周）。線（1 倍）と背景（2/3 倍）のどちらの色相も、ちょうど整数周になる */
const RAINBOW_WRAP = 3;

/**
 * 画面全体の空気: 演出の強さ、負けの暗さ、放射状の光、虹色、フラッシュ、bloom のブースト、
 * フィーバー（続いている間だけ光をビートに乗せる）、ヒットストップの震え・集中線・RGB のずれ、BGM の段階と終盤の高まり。
 * AirFrame を書くのはここだけで、ゲームごとの値（手番の色、溜めの絞り込みなど）は各ゲームの Atmosphere が足す。カメラはビートで動かさない。
 * 目標の値は演出が与え、ここで滑らかに寄せる（滑らかにするのと、ヒットストップの間も動くものは実時間）。
 * 画面全体の明滅と bloom のブーストは flare だけが出し、1 回の光ごとに FlashLimiter の許可を 1 回だけ得る。
 * 1 回のプレイごとに作る。
 */
export class Air {
  private readonly tuning: AirTuning;
  private readonly bgm: AirBgm;
  private readonly flashes: Pick<FlashLimiter, 'request'>;
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
  /** BGM の段階の目標と、終盤の高まり（0〜1） */
  private tier = 0;
  private riser = 0;
  private riserOn = true;
  private fever = 0;
  private feverShown = 0;
  private hitAmp = 0;
  private hitAt = 0;
  private hitDur = 0;
  private impactX = 0;
  private impactY = 0;
  private impactAt = PRESENT_LONG_AGO;
  private impactStrength = 0;
  private aberration = 0;
  private aberrationAngle = 0;

  constructor(tuning: AirTuning, bgm: AirBgm, flashes: Pick<FlashLimiter, 'request'>) {
    this.tuning = tuning;
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

  /** 負けの暗さを v まで上げる */
  darken(v: number): void {
    if (v > this.dread) this.dread = v;
  }

  /** 放射状の光を v まで広げる */
  spreadRays(v: number): void {
    if (v > this.rays) this.rays = v;
  }

  /** 線を虹色に回す */
  prism(v: number): void {
    if (v > this.rainbow) this.rainbow = v;
  }

  /** フィーバーの強さ（0〜1）。BGM の段階を上げ、光をビートに乗せる */
  setFever(level: number): void {
    this.fever = level;
  }

  /**
   * ヒットストップ: 実時間 real から duration 秒、amp の強さで止めた物を震わせる。
   * 震えは初めが大きく、だんだん小さくする。同時に (x, y) へ集中線と RGB のずれを出す
   */
  hitStop(x: number, y: number, amp: number, duration: number, real: number): void {
    const T = this.tuning;
    this.hitAmp = amp;
    this.hitAt = real;
    this.hitDur = duration;
    this.impactX = x;
    this.impactY = y;
    this.impactAt = real;
    this.impactStrength = Math.min(1, T.impact.base + amp);
    this.aberration = Math.max(this.aberration, T.aberration.base + T.aberration.perAmp * amp);
    this.aberrationAngle = real * T.aberration.angleRate;
  }

  /** BGM の段階（フィーバーの前）と、終盤の高まり（0〜1） */
  setProgress(tier: number, riser: number): void {
    this.tier = tier;
    this.riser = riser;
  }

  /** 終盤の高まりを止める（終わり）。終盤の高まりを使わないゲームでは何もしない */
  muteRiser(): void {
    this.riserOn = false;
    if (this.tuning.riser) this.bgm.setRiser(0);
  }

  update(ft: FrameTime, out: AirFrame): void {
    const T = this.tuning;
    const dt = ft.realDt;
    const decay = T.decay;
    this.intensityTarget = Math.max(0, this.intensityTarget - dt * T.intensity.fall);
    this.intensity = damp(this.intensity, this.intensityTarget, this.intensityTarget > this.intensity ? T.intensity.riseTau : T.intensity.fallTau, dt);
    this.dread *= Math.exp(-dt * decay.dread);
    this.rays *= Math.exp(-dt * decay.rays);
    this.rainbow *= Math.exp(-dt * decay.rainbow);
    this.rainbowTurns = (this.rainbowTurns + dt * T.rainbowTurnsPerSecond * this.rainbow) % RAINBOW_WRAP;
    this.flash *= Math.exp(-dt * decay.flash);
    if (this.flash < FLASH_EPSILON) this.flash = 0;
    this.bloomBoost *= Math.exp(-dt * decay.boost);
    this.glow = damp(this.glow, T.riser ? this.riser * T.riser.glow : 0, T.glowTau, dt);
    this.hue += ft.worldDt * (T.hue.base + this.intensity * T.hue.perIntensity);
    this.feverShown = damp(this.feverShown, this.fever, T.feverTau, dt);
    this.aberration *= Math.exp(-dt * decay.aberration);
    if (this.aberration < 1e-4) this.aberration = 0;

    this.bgm.setTier(Math.min(T.bgmTopTier, this.tier + (this.fever > 0 ? 1 : 0) + (this.fever >= 1 ? 1 : 0)));
    if (T.riser && this.riserOn) this.bgm.setRiser(this.riser * T.riser.bgm);

    const beatPos = this.bgm.beatPosition();
    const beat = Math.exp(-(beatPos - Math.floor(beatPos)) * T.beatSharpness);

    out.beat = beat * this.feverShown;
    out.fever = this.feverShown;
    const hitK = this.hitDur > 0 ? clamp01(1 - (ft.real - this.hitAt) / this.hitDur) : 0;
    out.hitShake = this.hitAmp * hitK * hitK;
    out.impactX = this.impactX;
    out.impactY = this.impactY;
    out.impactAt = this.impactAt;
    out.impactStrength = this.impactStrength;
    out.aberration = this.aberration;
    out.aberrationAngle = this.aberrationAngle;
    out.intensity = clamp01(this.intensity);
    out.hue = this.hue;
    out.glow = this.glow;
    out.flash = this.flash;
    out.dread = clamp01(this.dread);
    out.rays = clamp01(this.rays);
    out.rainbow = clamp01(this.rainbow);
    out.rainbowTurns = this.rainbowTurns;
    const B = T.bloom;
    out.bloomStrength = B.base + B.perIntensity * this.intensity + this.bloomBoost * B.boost;
  }
}
