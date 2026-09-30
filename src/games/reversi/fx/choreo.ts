import { CHOREO, flipTier } from '../config.ts';
import type { ChoreoTuning } from '../config.ts';
import { flipLines } from '../rules/position.ts';
import type { Color, FlipLine, MoveOutcome, Position } from '../rules/position.ts';
import type { Side } from '../types.ts';

/** 押している間に震える、返る石とその向き（ワールド座標の単位ベクトル） */
export type PreviewFlip = { readonly square: number; readonly dirX: number; readonly dirY: number };

/** 返る石のない予告。使い回す */
export const NO_FLIPS: readonly PreviewFlip[] = Object.freeze([]);

/** 1 枚の石が返る演出 */
type FlipCue = {
  square: number;
  /** 返り始める順番（0 から）。同じ時刻に返り始める石は、方向の順で並べる */
  order: number;
  /** 返り始める時刻と、返りきるまでの長さ（手の始まりからの世界時間の秒） */
  start: number;
  duration: number;
  /** 余分に回る周数（半周に足す） */
  spins: number;
  /** 浮く高さ（石の半径を 1 とした倍率） */
  lift: number;
  /** 返る向き（打ったマスから外へ向かう単位ベクトル。ワールド座標なので、盤の右と上が正） */
  dirX: number;
  dirY: number;
};

/** 同じ時刻に返りきる石のまとまり。音と粒はまとまりごとに 1 回出す */
type LandingStep = {
  /** 返りきる時刻（手の始まりからの世界時間の秒） */
  time: number;
  /** この時刻に返りきる石の数 */
  count: number;
  /** 手の中で何番目のまとまりか（0 から）。音階の位置に使う */
  index: number;
};

/** 1 手の演出の時間割。時刻はすべて手の始まりからの世界時間の秒 */
export type MoveChoreo = {
  mover: Side;
  color: Color;
  square: number;
  /** 石が盤に着く時刻（落ちている長さでもある） */
  landAt: number;
  /** 最初の石が返り始める時刻 */
  waveAt: number;
  /** 最後の石が返りきる時刻 */
  lastLandAt: number;
  /** 余韻まで含めた、手の演出が終わる時刻 */
  end: number;
  flips: readonly FlipCue[];
  steps: readonly LandingStep[];
  /** 返した枚数と、演出の段階（人の手だけ。CPU の手は 0） */
  count: number;
  tier: number;
};

const holdOf = (t: ChoreoTuning, n: number): number => t.holdBase + t.holdPerFlip * Math.min(n, t.holdCap);
const stepOf = (t: ChoreoTuning, n: number): number => Math.max(t.stepMin, t.stepMax - t.stepPerFlip * n);

/** 返る石の並びの向き（盤の行は下へ増えるので、上向きのワールド座標へ直す）。0 は +0 にそろえる */
const worldDirX = (line: FlipLine): number => (line.dx === 0 ? 0 : line.dx / Math.hypot(line.dx, line.dy));
const worldDirY = (line: FlipLine): number => (line.dy === 0 ? 0 : -line.dy / Math.hypot(line.dx, line.dy));

/**
 * 着手から、1 手の演出の時間割を決める。
 * 石が落ちて盤に着き、溜めのあと、打ったマスから方向ごとに外へ向かって 1 枚ずつ返っていく。
 * 返る枚数が多いほど、溜めを長く、返る間隔を短くする。返り始める順番が後の石ほど高く浮き、多く回る（人の手だけ）。
 */
export function choreograph(outcome: MoveOutcome, mover: Side): MoveChoreo {
  const t = CHOREO[mover];
  const n = outcome.lines.reduce((sum, l) => sum + l.squares.length, 0);
  const landAt = t.drop;
  const waveAt = landAt + holdOf(t, n);
  const step = stepOf(t, n);

  const flips: FlipCue[] = [];
  for (const line of outcome.lines) {
    const dirX = worldDirX(line);
    const dirY = worldDirY(line);
    for (let i = 0; i < line.squares.length; i++) {
      flips.push({ square: line.squares[i], order: 0, start: waveAt + i * step, duration: 0, spins: 0, lift: 0, dirX, dirY });
    }
  }
  // 返り始める時刻の順。同じ時刻なら方向の順（lines の並び）を保つ
  flips.sort((a, b) => a.start - b.start);
  for (let i = 0; i < flips.length; i++) {
    const f = flips[i];
    f.order = i;
    f.spins = t.spinsEvery > 0 ? Math.min(t.spinsMax, Math.floor(i / t.spinsEvery)) : 0;
    f.duration = t.flipBase + t.flipPerSpin * f.spins;
    f.lift = Math.min(t.liftMax, t.liftBase + t.liftPerOrder * i);
  }

  // 返りきる時刻でまとめる。回る周数で長さが変わるので、始まりの順と着く順は同じとは限らない
  const lands = flips.map((f) => f.start + f.duration).sort((a, b) => a - b);
  const steps: LandingStep[] = [];
  for (const time of lands) {
    const last = steps[steps.length - 1];
    if (last && Math.abs(last.time - time) < 1e-9) last.count++;
    else steps.push({ time, count: 1, index: steps.length });
  }
  const lastLandAt = lands.length > 0 ? lands[lands.length - 1] : landAt;

  return {
    mover,
    color: outcome.color,
    square: outcome.square,
    landAt,
    waveAt,
    lastLandAt,
    end: lastLandAt + t.settle,
    flips,
    steps,
    count: n,
    tier: mover === 'human' ? flipTier(n) : 0,
  };
}

/** 局面 p で手番の側が square に打ったら返る石と、その向き（押している間の予告に使う） */
export function previewFlips(p: Position, square: number): PreviewFlip[] {
  const out: PreviewFlip[] = [];
  for (const line of flipLines(p, square)) {
    const dirX = worldDirX(line);
    const dirY = worldDirY(line);
    for (const s of line.squares) out.push({ square: s, dirX, dirY });
  }
  return out;
}
