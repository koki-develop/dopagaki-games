/**
 * sim のテストの道具。調整値とステージの組み立て、自動プレイの入力、テストの準備のための盤面の操作をまとめる。
 * ボールを決まった位置と向きに置くには sim の内部へ触るしかないので、その操作はこのファイルだけに置く。
 */
import { COLS, FIELD_H, sanitizeTuning, tuning } from '../config.ts';
import type { BlockType, SimConfig, Tuning } from '../config.ts';
import type { BallStore } from './balls.ts';
import type { BlockField } from './blocks.ts';
import { Sim } from './sim.ts';
import type { SimInput, SimMode } from './sim.ts';

type Internals = { ballStore: BallStore; field: BlockField; _attached: boolean };
const inner = (sim: Sim) => sim as unknown as Internals;

/** 初期の調整値を patch で書き換え、範囲に収めたもの */
export function simConfig(patch?: (t: Tuning) => void): SimConfig {
  const t = structuredClone(tuning) as Tuning;
  patch?.(t);
  return sanitizeTuning(t);
}

export function makeSim(mode: SimMode, seed = 1, patch?: (t: Tuning) => void): Sim {
  return new Sim({ mode, seed, config: simConfig(patch) });
}

export const ENDLESS: SimMode = { kind: 'endless' };
export const emptyRows = (n: number): string[] => Array.from({ length: n }, () => '.'.repeat(COLS));
/** 列 col にだけ ch を置いた 1 行 */
export const line = (col: number, ch: string): string => '.'.repeat(col) + ch + '.'.repeat(COLS - col - 1);
export const stageMode = (rows: string[]): SimMode => ({ kind: 'stage', stage: { id: 'test', name: 'TEST', rows } });

/** 上に 3 行の空きを残し、その下をボール入りで埋めた盤面。一番下の行は左端から右端までボール入り */
export const PLAIN: SimMode = stageMode(emptyRows(3).concat(Array.from({ length: 17 }, () => 'o'.repeat(COLS))));

/** ボール入り・ハード（HP 6 / 7 / 9）・ボール大量を混ぜた、ぎっしり詰まった盤面 */
export const MIXED: SimMode = stageMode([
  ...emptyRows(3),
  '999999999999',
  '977777777779',
  '97MMMMMMMM79',
  '97MMMMMMMM79',
  '977777777779',
  '99999oo99999',
  'ooooMooMoooo',
  'oooooooooooo',
  '6o6o6o6o6o6o',
  'oooooooooooo',
  'o6o6o6o6o6o6',
  'oooooooooooo',
  '99oooooooo99',
  'ooooMooMoooo',
  'oooooooooooo',
  'oooooooooooo',
  'oooooooooooo',
]);

/** パドルをいまの位置に置いたままにする入力 */
export const hold = (sim: Sim, launch = false): SimInput => ({ paddleTargetX: sim.paddleX, launch });

/** 一番低い下向きのボールを追いかける自動プレイの入力（乱数を使わないので決定的） */
export function autoplayInput(sim: Sim, k: number): SimInput {
  let target = 4.5;
  let lowest = Infinity;
  const b = sim.balls;
  for (let j = 0; j < b.count; j++) {
    if (b.dy[j] < 0 && b.y[j] < lowest) {
      lowest = b.y[j];
      target = b.x[j];
    }
  }
  return { paddleTargetX: target + (((k * 37) % 11) - 5) * 0.08, launch: sim.attached };
}

/** ボールを 1 個置き（発射待ちを解除する）、その添字を返す */
export function placeBall(sim: Sim, x: number, y: number, dx: number, dy: number): number {
  inner(sim)._attached = false;
  const l = Math.hypot(dx, dy);
  return inner(sim).ballStore.add(x, y, dx / l, dy / l);
}

/** 飛んでいるボールをすべて消す。発射待ちかどうかは変えない */
export function clearBalls(sim: Sim): void {
  inner(sim).ballStore.count = 0;
}

/** パドルに乗ったボールを消し、ボールが 1 個もない状態にする（次のステップでボール 0 になる） */
export function dropAllBalls(sim: Sim): void {
  inner(sim)._attached = false;
  inner(sim).ballStore.count = 0;
}

/** 行 row（一番下が 0）・列 col のセルを、種類 type・HP hp のブロックに置き直す */
export function setBlock(sim: Sim, row: number, col: number, type: BlockType, hp: number): void {
  inner(sim).field.setCell(row, col, type, hp, sim.time);
}

/** 見えている行（天井の外の予備の行を除く）のブロックをすべて消す */
export function clearVisibleRows(sim: Sim): void {
  const f = inner(sim).field;
  for (let row = 0; row < f.rowCount; row++) {
    if (f.rowBottomY(row) >= FIELD_H - 1e-6) continue;
    for (let col = 0; col < COLS; col++) f.removeAt(f.slotOf(row) * COLS + col);
  }
}
