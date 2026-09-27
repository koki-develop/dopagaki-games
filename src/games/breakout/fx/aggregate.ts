import { clamp01 } from '../../../shared/math.ts';
import { BlockType } from '../config.ts';
import { EventKind, Signal } from '../sim/events.ts';
import type { EventQueue } from '../sim/events.ts';

/** 1 フレームで演出を付けるイベント数の上限（品質の倍率を掛ける前） */
export const MAX_BREAK_FX = 48;
export const MAX_DEBRIS_FX = 28;
export const MAX_HARD_FX = 16;
export const MAX_OVERFLOW_FX = 24;
/** ボール大量ブロックの弾ける演出を 1 フレームで出す数 */
const MAX_MEGA_FX = 3;
/** パドルの火花を出す数（打ち出しも数に含める） */
const MAX_PADDLE_FX = 4;
/** 壁の揺れを記録する数 */
export const MAX_WALL_FX = 2;

/** 演出を付けるイベントの印。1 つのイベントに複数付くことがある */
export const FxFlag = {
  /** ボール大量ブロックが弾ける */
  Mega: 1,
  /** ブロックが壊れる光と火花 */
  Break: 2,
  /** 破片 */
  Debris: 4,
  /** ハードに当たった火花 */
  HardSpark: 8,
  /** パドルの火花 */
  PaddleSpark: 16,
  /** 壁の揺れ */
  Wall: 32,
  /** 上限を超えたボールの光の筋 */
  Overflow: 64,
} as const;

/** 演出を付けるイベントの数の上限。どのイベントも一覧には 1 回しか入らない */
export const FX_LIST_CAPACITY = MAX_BREAK_FX + MAX_MEGA_FX + MAX_HARD_FX + MAX_PADDLE_FX + MAX_WALL_FX + MAX_OVERFLOW_FX;

/**
 * 1 フレームぶんのイベントの集計。演出の側で 1 つ作って使い回す。
 * 演出を付けるイベントは、発生した順に index（イベント列の位置）と flags（FxFlag の組み合わせ）で並ぶ。
 */
export class FrameSummary {
  /** 壊れたブロックの数（イベント列からあふれた分も含む） */
  breaks = 0;
  /** イベント列に残っている破壊のうち、一番大きい chain 数 */
  maxChain = 0;
  /** ボール大量ブロックの破壊数と、最初の 1 つの chain 数 */
  megaCount = 0;
  megaChain = 0;
  /** ハードに当たった数（あふれた分も含む）と、残り HP の割合の最小値 */
  hardCount = 0;
  hardMinRatio = 1;
  /** パドルで打った数と打ち出した数の合計、最後に当たったパドル上の位置（-1〜1） */
  paddleCount = 0;
  paddleT = 0;
  /** 壁に当たった数（あふれた分も含む） */
  wallCount = 0;
  signals = 0;
  /** ステージクリアの位置。StageClear が立っているときだけ意味がある */
  clearX = 0;
  clearY = 0;
  readonly index = new Int32Array(FX_LIST_CAPACITY);
  readonly flags = new Uint8Array(FX_LIST_CAPACITY);
  length = 0;
}

/**
 * イベント列を集計し、演出を付けるイベントを選ぶ。
 * 破壊は全体から均等に間引き、ほかの種類は先に起きたものから上限まで選ぶ。上限は budget（0〜1）で縮める。
 * イベント列は変えない。
 */
export function summarize(ev: EventQueue, budget: number, out: FrameSummary): FrameSummary {
  const b = clamp01(budget);
  const breaks = ev.counts[EventKind.BlockBreak];
  const breakLimit = Math.ceil(MAX_BREAK_FX * b);
  const debrisLimit = Math.ceil(MAX_DEBRIS_FX * b);
  const hardLimit = MAX_HARD_FX * b;
  const breakStride = breaks > breakLimit ? breaks / breakLimit : 1;

  out.breaks = breaks;
  out.maxChain = 0;
  out.megaCount = 0;
  out.megaChain = 0;
  out.hardCount = ev.counts[EventKind.HardHit];
  out.hardMinRatio = 1;
  out.paddleCount = 0;
  out.paddleT = 0;
  out.wallCount = ev.counts[EventKind.WallHit];
  out.signals = ev.signals;
  const cleared = (ev.signals & Signal.StageClear) !== 0;
  out.clearX = cleared ? ev.signalX : 0;
  out.clearY = cleared ? ev.signalY : 0;

  let n = 0;
  let breakFx = 0;
  let debrisFx = 0;
  let hardFx = 0;
  let overflowFx = 0;
  let wallFx = 0;
  let breakIdx = 0;
  let nextBreakFx = 0;
  for (let i = 0; i < ev.length; i++) {
    const kind = ev.kind[i];
    let flags = 0;
    if (kind === EventKind.BlockBreak) {
      const chain = ev.b[i];
      if (chain > out.maxChain) out.maxChain = chain;
      if (ev.a[i] === BlockType.Mega) {
        if (out.megaCount === 0) out.megaChain = chain;
        out.megaCount++;
        if (out.megaCount <= MAX_MEGA_FX) flags |= FxFlag.Mega;
      }
      if (breakIdx >= nextBreakFx && breakFx < breakLimit) {
        nextBreakFx += breakStride;
        breakFx++;
        flags |= FxFlag.Break;
        if (debrisFx < debrisLimit) {
          debrisFx++;
          flags |= FxFlag.Debris;
        }
      }
      breakIdx++;
    } else if (kind === EventKind.HardHit) {
      const ratio = ev.b[i] > 0 ? ev.a[i] / ev.b[i] : 1;
      if (ratio < out.hardMinRatio) out.hardMinRatio = ratio;
      if (hardFx < hardLimit) {
        hardFx++;
        flags |= FxFlag.HardSpark;
      }
    } else if (kind === EventKind.PaddleHit) {
      out.paddleCount++;
      out.paddleT = ev.a[i];
      if (out.paddleCount <= MAX_PADDLE_FX) flags |= FxFlag.PaddleSpark;
    } else if (kind === EventKind.Launch) {
      out.paddleCount++;
    } else if (kind === EventKind.WallHit) {
      if (ev.a[i] !== 0 && wallFx < MAX_WALL_FX) {
        wallFx++;
        flags |= FxFlag.Wall;
      }
    } else if (kind === EventKind.Overflow) {
      if (overflowFx < MAX_OVERFLOW_FX) {
        overflowFx++;
        flags |= FxFlag.Overflow;
      }
    }
    if (flags !== 0 && n < FX_LIST_CAPACITY) {
      out.index[n] = i;
      out.flags[n] = flags;
      n++;
    }
  }
  out.length = n;
  return out;
}
