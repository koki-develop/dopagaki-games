import { PRESENT_LONG_AGO } from '../../../juice/frame-time.ts';
import { SHOCKWAVE } from '../config.ts';
import { MAX_HANDS } from '../rules/round.ts';
import { LOOK } from '../view/look.ts';

/**
 * 演出の状態。1 回のプレイごとに作り直し、描画側が毎フレームそのまま uniform に写す。three.js に依存しない素の値だけを持つ。
 * 値のまとまりごとに、書くのは 1 つの部品だけにする:
 * - Atmosphere（画面全体の空気）: beat 〜 dread、bloomStrength、focus〜
 * - Director（卓そのもの）: shockwaves、tableAppear、active〜、spots、finalRound
 * 時刻は、集中線（impactAt、実時間の軸。シェーダーの u.real）のほかは present の時間軸（シェーダーの u.time）。
 * カードとチップの 1 枚ごとの状態は CardField と ChipField が持つ。
 */
export type FxState = {
  /** ビートの直後に 1 になって減衰する値。フィーバーの強さを掛けてあり、フィーバーでなければ 0 */
  beat: number;
  /** フィーバーの強さ（0〜1） */
  fever: number;
  /** ヒットストップで止めたカードとチップを震わせる強さ（0 で震えない） */
  hitShake: number;
  /** 集中線の中心、始めた実時間、強さ（0〜1） */
  impactX: number;
  impactY: number;
  impactAt: number;
  impactStrength: number;
  /** RGB のずれの量（画面の幅に対する割合）と向き（ラジアン） */
  aberration: number;
  aberrationAngle: number;
  /** 0〜1 の演出の強さ（勝ちの段階と連勝から） */
  intensity: number;
  /** 背景の色相のずれ（0〜1 で 1 周） */
  hue: number;
  /** 背景の明るさの上乗せ（終盤の高まり） */
  glow: number;
  /** 画面全体のフラッシュの強さ。見えないほど小さくなったら 0 にする */
  flash: number;
  /** 背景の放射状の光の強さ（0〜1）。ブラックジャックと大きな勝ちで広がる */
  rays: number;
  /** 卓の線の色が虹色に回る強さ（0〜1）。ブラックジャック、段階 4 の勝ち、最高スコアの更新、増やして終えた決着だけ */
  rainbow: number;
  /** 虹色で卓の線の色相が回った量（周） */
  rainbowTurns: number;
  /** 負けの暗さ（0〜1） */
  dread: number;
  /** bloom の強さ */
  bloomStrength: number;
  /** 溜めで画面の縁から絞り込む強さ（0〜1）と、絞り込む先 */
  focus: number;
  focusX: number;
  focusY: number;
  /** 衝撃波。1 件あたり (x, y, 開始時刻, 速さ（u / 秒）) の 4 値を SHOCKWAVE.slots 件 */
  shockwaves: Float32Array;
  /** 卓が現れる進み具合（0〜1） */
  tableAppear: number;
  /** 操作を待っている手を光らせる強さ（0〜1）と、その手のまわりの範囲（中心と半分の大きさ） */
  active: number;
  activeX: number;
  activeY: number;
  activeHW: number;
  activeHH: number;
  /** 賭けの丸。1 件あたり (x, y, 半径, 出す強さ 0〜1) の 4 値を MAX_HANDS 件 */
  spots: Float32Array;
  /** 最後のラウンドか（0 / 1）。卓の印刷を脈打たせる */
  finalRound: number;
};

/** 衝撃波が出ていないときの速さ（u / 秒）。開始時刻が PRESENT_LONG_AGO なので、この値で輪は見えない */
const SHOCK_SPEED_IDLE = 12;

/** 何も起きていない衝撃波の記録（開始時刻が PRESENT_LONG_AGO） */
export function createShockwaves(): Float32Array {
  const r = new Float32Array(SHOCKWAVE.slots * 4);
  for (let i = 0; i < SHOCKWAVE.slots; i++) {
    r[i * 4 + 2] = PRESENT_LONG_AGO;
    r[i * 4 + 3] = SHOCK_SPEED_IDLE;
  }
  return r;
}

/** 出していない賭けの丸の記録 */
export const createSpots = (): Float32Array => new Float32Array(MAX_HANDS * 4);

/** 何も起きていない演出の状態 */
export function createFxState(): FxState {
  return {
    beat: 0,
    fever: 0,
    hitShake: 0,
    impactX: 0,
    impactY: 0,
    impactAt: PRESENT_LONG_AGO,
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
    dread: 0,
    bloomStrength: LOOK.bloom.base,
    focus: 0,
    focusX: 0,
    focusY: 0,
    shockwaves: createShockwaves(),
    tableAppear: 1,
    active: 0,
    activeX: 0,
    activeY: 0,
    activeHW: 0,
    activeHH: 0,
    spots: createSpots(),
    finalRound: 0,
  };
}
