import { PRESENT_LONG_AGO } from '../../../juice/frame-time.ts';
import { clamp01 } from '../../../shared/math.ts';
import { MAX_STACK, RACK_CAP, RACK_COLUMNS } from '../denominations.ts';
import { MAX_HANDS } from '../rules/round.ts';
import { moveEase } from './cards.ts';

/**
 * 卓に同時に出せるチップの枚数。先頭に手持ちの山（RACK_COLUMNS 列、1 列 RACK_CAP 枚まで）、その後に手ごとの賭けの山と払い戻しの山
 * （それぞれ MAX_STACK 枚まで）の枠を持つ。枠の順に描くので、手の山や飛んでいるチップは手持ちの山より上に重なる
 */
export const RACK_SLOTS = RACK_COLUMNS * RACK_CAP;
export const CHIP_SLOTS = RACK_SLOTS + MAX_HANDS * 2 * MAX_STACK;
/** 1 枚あたりの値の数（vec4 が 4 本） */
export const CHIP_LANES = 4;
export const CHIP_STRIDE = CHIP_LANES * 4;

/**
 * 並び（1 枚ごとに CHIP_STRIDE 個）:
 * - 0: 動き始めの位置 x, y、動いた先の位置 x, y
 * - 1: 動き始める時刻, 動く長さ, 動く間の見かけの高さ, 額面（CHIP_VALUES の添字 + 1。0 は出していない）
 * - 2: 消し始めた時刻（手持ちへ集め終えた、ディーラーに取られた）, 暗くし始めた時刻, 着いた時刻, 光り始めた時刻（勝ったラウンドの払い戻し）
 * - 3: 上の面の向き（ラジアン。枠ごとに決まっていて、山のチップの模様がそろわないようにする）, 空き 3 つ
 */
export const CHIP_OFFSET = {
  fromX: 0,
  fromY: 1,
  toX: 2,
  toY: 3,
  moveStart: 4,
  moveDur: 5,
  lift: 6,
  face: 7,
  fadeAt: 8,
  dimAt: 9,
  landAt: 10,
  shineAt: 11,
  spin: 12,
} as const;

/** 枠 s のチップの上の面の向き（黄金比で散らす） */
const spinOf = (s: number): number => ((s * 0.618034) % 1) * Math.PI * 2;

const O = CHIP_OFFSET;

/** 消すまでの長さ（present の秒）。シェーダー（view/chips.ts）と同じ値で消す */
export const CHIP_FADE = 0.12;

/**
 * 卓のチップの見た目の状態。演出（ディレクター）が書き、描画（ChipsView）が版の変わったときに写す。
 * 時刻はすべて present の時間軸の秒。動きは CardField と同じ式（moveEase）で、シェーダーが時刻から計算する。
 * 枠の順に描くので、山の上のチップほど後ろの枠に置く。
 */
export class ChipField {
  readonly data = new Float32Array(CHIP_SLOTS * CHIP_STRIDE);
  version = 0;
  private readonly here = { x: 0, y: 0 };

  constructor() {
    this.clear();
  }

  clear(): void {
    this.clearSlots(0, CHIP_SLOTS);
  }

  /** 枠 from から to の手前までのチップを消す */
  clearSlots(from: number, to: number): void {
    for (let s = from; s < to; s++) this.reset(s);
    this.version++;
  }

  /**
   * 枠 slot に額面 denomination（CHIP_VALUES の添字）のチップを置き、時刻 at から duration かけて (fromX, fromY) から (toX, toY) へ飛ばす。
   * 前にその枠にあったチップの状態（暗くした・消した・光らせた）は捨てる
   */
  fly(slot: number, denomination: number, fromX: number, fromY: number, toX: number, toY: number, at: number, duration: number, lift: number): void {
    this.reset(slot);
    this.move(slot, fromX, fromY, toX, toY, at, duration, lift);
    this.data[slot * CHIP_STRIDE + O.face] = denomination + 1;
  }

  /** 枠 slot のチップを、時刻 at のその場所から (toX, toY) へ飛ばす */
  flyFromHere(slot: number, toX: number, toY: number, at: number, duration: number, lift: number): void {
    const p = this.positionAt(slot, at);
    this.move(slot, p.x, p.y, toX, toY, at, duration, lift);
  }

  /** 時刻 at から消す */
  fade(slot: number, at: number): void {
    this.data[slot * CHIP_STRIDE + O.fadeAt] = at;
    this.version++;
  }

  /** 時刻 at から暗くする（ディーラーに取られるチップ） */
  dim(slot: number, at: number): void {
    this.data[slot * CHIP_STRIDE + O.dimAt] = at;
    this.version++;
  }

  /** 時刻 at から縁に光を走らせる（勝ったラウンドの払い戻し） */
  shine(slot: number, at: number): void {
    this.data[slot * CHIP_STRIDE + O.shineAt] = at;
    this.version++;
  }

  /** 枠 slot のチップの額面（CHIP_VALUES の添字）。出していなければ -1 */
  denominationOf(slot: number): number {
    return this.data[slot * CHIP_STRIDE + O.face] - 1;
  }

  /** 枠 slot のチップの時刻 t の位置。返す入れ物は使い回す */
  positionAt(slot: number, t: number): { x: number; y: number } {
    const d = this.data;
    const o = slot * CHIP_STRIDE;
    const e = moveEase(clamp01((t - d[o + O.moveStart]) / Math.max(1e-3, d[o + O.moveDur])));
    this.here.x = d[o + O.fromX] + (d[o + O.toX] - d[o + O.fromX]) * e;
    this.here.y = d[o + O.fromY] + (d[o + O.toY] - d[o + O.fromY]) * e;
    return this.here;
  }

  private move(slot: number, fromX: number, fromY: number, toX: number, toY: number, at: number, duration: number, lift: number): void {
    const d = this.data;
    const o = slot * CHIP_STRIDE;
    d[o + O.fromX] = fromX;
    d[o + O.fromY] = fromY;
    d[o + O.toX] = toX;
    d[o + O.toY] = toY;
    d[o + O.moveStart] = at;
    d[o + O.moveDur] = duration;
    d[o + O.lift] = lift;
    d[o + O.landAt] = at + duration;
    this.version++;
  }

  private reset(s: number): void {
    const d = this.data;
    const o = s * CHIP_STRIDE;
    d.fill(0, o, o + CHIP_STRIDE);
    d[o + O.moveStart] = PRESENT_LONG_AGO;
    d[o + O.moveDur] = 1;
    d[o + O.fadeAt] = PRESENT_LONG_AGO;
    d[o + O.dimAt] = PRESENT_LONG_AGO;
    d[o + O.landAt] = PRESENT_LONG_AGO;
    d[o + O.shineAt] = PRESENT_LONG_AGO;
    d[o + O.spin] = spinOf(s);
  }
}
