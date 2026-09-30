import { RIPPLE, SHOCKWAVE } from '../config.ts';
import { LOOK } from '../view/look.ts';
import { LONG_AGO } from './discs.ts';

/**
 * 演出の状態。1 回のプレイごとに作り直し、描画側が毎フレームそのまま uniform に写す。three.js に依存しない素の値だけを持つ。
 * 値のまとまりごとに、書くのは 1 つの部品だけにする:
 * - Atmosphere（画面全体の空気）: beat 〜 dread、bloomStrength
 * - BoardWaves（盤の波紋と衝撃波）: ripples、shockwaves
 * - PointerFx（押しているマス、カーソル）: cursor〜、hover〜、markerHue
 * - Director（盤そのもの）: boardAppear、last〜
 * 時刻は、集中線（impactAt、実時間の軸。シェーダーの u.real）のほかは present の時間軸（シェーダーの u.time）。
 * 石ごとの状態は DiscField が持つ。
 */
export type FxState = {
  /** ビートの直後に 1 になって減衰する値。フィーバーの強さを掛けてあり、フィーバーでなければ 0 */
  beat: number;
  /** フィーバーの強さ（0〜1） */
  fever: number;
  /** ヒットストップで止めた石を震わせる中心と強さ（0 で震えない） */
  hitX: number;
  hitY: number;
  hitShake: number;
  /** 集中線の中心、始めた実時間、強さ（0〜1） */
  impactX: number;
  impactY: number;
  impactAt: number;
  impactStrength: number;
  /** RGB のずれの量（画面の幅に対する割合）と向き（ラジアン） */
  aberration: number;
  aberrationAngle: number;
  /** 0〜1 の演出の強さ（返した枚数と連続から） */
  intensity: number;
  /** 背景の色相のずれ（0〜1 で 1 周） */
  hue: number;
  /** 背景の明るさの上乗せ（終盤の高まりなど） */
  glow: number;
  /** 画面全体のフラッシュの強さ。見えないほど小さくなったら 0 にする */
  flash: number;
  /** 背景の放射状の光の強さ（0〜1）。大きな手で広がる */
  rays: number;
  /** 盤の線の色が虹色に回る強さ（0〜1）。段階 4 の手、最高スコアの更新、勝ちの締めの波、パーフェクトだけ */
  rainbow: number;
  /** 虹色で盤の線の色相が回った量（周）。回る速さは虹色の強さに比例する */
  rainbowTurns: number;
  /** 手番の色（0 で CPU、1 で人）。滑らかに寄せる */
  turnTint: number;
  /** CPU の重い手の暗さ（0〜1） */
  dread: number;
  /** bloom の強さ */
  bloomStrength: number;
  /** 波紋。1 件あたり (x, y, 開始時刻, 強さ) の 4 値を RIPPLE.slots 件 */
  ripples: Float32Array;
  /** 衝撃波。1 件あたり (x, y, 開始時刻, 速さ（u / 秒）) の 4 値を SHOCKWAVE.slots 件 */
  shockwaves: Float32Array;
  /** キーボードのカーソルのマスの中心と、見せる強さ（0〜1） */
  cursorX: number;
  cursorY: number;
  cursor: number;
  /** 押している・ホバーしているマスの中心と、見せる強さ（0〜1）、打てるマスか（1 / 0） */
  hoverX: number;
  hoverY: number;
  hover: number;
  hoverLegal: number;
  /** 合法手の印と押している間の予告の色相（人の石の縁の色） */
  markerHue: number;
  /** 盤が現れる進み具合（0〜1） */
  boardAppear: number;
  /** 最後に打ったマスの中心と、打った時刻 */
  lastX: number;
  lastY: number;
  lastAt: number;
};

/** 何も起きていない 4 値ずつの記録（開始時刻が LONG_AGO、4 つ目は idle） */
function idleSlots(slots: number, idle: number): Float32Array {
  const r = new Float32Array(slots * 4);
  for (let i = 0; i < slots; i++) {
    r[i * 4 + 2] = LONG_AGO;
    r[i * 4 + 3] = idle;
  }
  return r;
}

/** 何も起きていない波紋の記録（開始時刻が LONG_AGO、強さ 0） */
export const createRipples = (): Float32Array => idleSlots(RIPPLE.slots, 0);

/** 衝撃波が出ていないときの速さ（u / 秒）。開始時刻が LONG_AGO なので、この値で輪は見えない */
const SHOCK_SPEED_IDLE = 12;

/** 何も起きていない衝撃波の記録（開始時刻が LONG_AGO） */
export const createShockwaves = (): Float32Array => idleSlots(SHOCKWAVE.slots, SHOCK_SPEED_IDLE);

/** 何も起きていない演出の状態 */
export function createFxState(): FxState {
  return {
    beat: 0,
    fever: 0,
    hitX: 0,
    hitY: 0,
    hitShake: 0,
    impactX: 0,
    impactY: 0,
    impactAt: LONG_AGO,
    impactStrength: 0,
    aberration: 0,
    aberrationAngle: 0,
    intensity: 0,
    hue: 0,
    glow: 0,
    flash: 0,
    rays: 0,
    rainbow: 0,
    rainbowTurns: 0,
    turnTint: 1,
    dread: 0,
    bloomStrength: LOOK.bloom.base,
    ripples: createRipples(),
    shockwaves: createShockwaves(),
    cursorX: 0,
    cursorY: 0,
    cursor: 0,
    hoverX: 0,
    hoverY: 0,
    hover: 0,
    hoverLegal: 0,
    markerHue: 0,
    boardAppear: 1,
    lastX: 0,
    lastY: 0,
    lastAt: LONG_AGO,
  };
}
