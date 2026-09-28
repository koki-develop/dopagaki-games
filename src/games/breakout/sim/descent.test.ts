import { describe, expect, test } from 'bun:test';
import { STEP_DT, sanitizeTuning, tuning } from '../config.ts';
import { Descent, MAX_FIELD_MOVE_PER_STEP, descentRateAt } from './descent.ts';

const ROW = 1;
const STEP_SECONDS = 0.12;

/** steps ステップ進めて、動いた距離と着地の回数を返す */
function run(d: Descent, steps: number, rowsPerStep: number) {
  let moved = 0;
  let stepLandings = 0;
  let penaltyLandings = 0;
  let refillLandings = 0;
  for (let i = 0; i < steps; i++) {
    const r = d.advance(STEP_DT, rowsPerStep, ROW, STEP_SECONDS);
    moved += r.delta;
    if (r.stepLanded) stepLandings++;
    if (r.penaltyLanded) penaltyLandings++;
    if (r.refillLanded) refillLandings++;
  }
  return { moved, stepLandings, penaltyLandings, refillLandings };
}

describe('降下速度', () => {
  test('0.1 行/秒から始まり、1 分ごとに 0.2 行/秒ずつ上限なく上がる', () => {
    const e = sanitizeTuning(tuning).endless;
    expect(descentRateAt(e, 0)).toBeCloseTo(0.1, 12);
    expect(descentRateAt(e, 60)).toBeCloseTo(0.3, 12);
    expect(descentRateAt(e, 600)).toBeCloseTo(2.1, 12);
    expect(descentRateAt(e, 6000)).toBeCloseTo(20.1, 12);
  });
});

describe('Descent', () => {
  test('1 段の落下時間より速い速度でも、その速さで降りる（溜まる量は 1 未満に保つ）', () => {
    for (const rate of [2, 8, 12, 30, 200]) {
      const d = new Descent();
      const seconds = 5;
      const { moved } = run(d, seconds * 120, rate * STEP_DT);
      // 最後の 1 段の落下時間ぶんだけ遅れる
      expect(moved).toBeGreaterThan(rate * (seconds - STEP_SECONDS) - 1);
      expect(moved).toBeLessThanOrEqual(rate * seconds + 1e-9);
      expect(d.backlog).toBeLessThan(1);
    }
  });

  test('遅い速度では、1 段ずつ加速して落ちて着地する', () => {
    const d = new Descent();
    const deltas: number[] = [];
    let landedAt = -1;
    for (let i = 0; i < 40; i++) {
      const r = d.advance(STEP_DT, i === 0 ? 1 : 0, ROW, STEP_SECONDS);
      deltas.push(r.delta);
      if (r.stepLanded) landedAt = i;
    }
    expect(landedAt).toBe(Math.ceil(STEP_SECONDS / STEP_DT) - 1);
    // 着地のステップは落下時間の途中で終わるので、その手前までは毎ステップ速くなる
    for (let i = 1; i < landedAt; i++) expect(deltas[i]).toBeGreaterThan(deltas[i - 1]);
    for (let i = landedAt + 1; i < deltas.length; i++) expect(deltas[i]).toBe(0);
    expect(deltas.reduce((a, b) => a + b, 0)).toBeCloseTo(ROW, 12);
  });

  test('ペナルティは落ちている途中の段の残りを引き取り、ペナルティとして着地する', () => {
    const d = new Descent();
    let moved = run(d, 5, 1).moved;
    // 最初のステップで 1 段が始まっている（以後も毎ステップ 1 段ずつ溜まるので、ここからは止める）
    expect(d.activeStepDrops).toBeGreaterThan(0);
    d.startPenalty(3, 0.28);
    expect(d.activeStepDrops).toBe(0);
    const r = run(d, 60, 0);
    moved += r.moved;
    expect(r.penaltyLandings).toBe(1);
    expect(r.refillLandings).toBe(0);
    expect(r.stepLandings).toBe(0);
    expect(moved).toBeCloseTo(5 + 3, 9);
  });

  test('大きな落下の間は 1 段の降下を始めず、着地した後に溜まった分を始める', () => {
    const d = new Descent();
    d.startPenalty(3, 0.28);
    const during = run(d, 20, 0.2);
    expect(d.activeStepDrops).toBe(0);
    expect(during.stepLandings).toBe(0);
    expect(d.backlog).toBeGreaterThanOrEqual(1);
    const rest = run(d, 60, 0);
    expect(rest.penaltyLandings).toBe(1);
    expect(rest.stepLandings).toBeGreaterThan(0);
    expect(during.moved + rest.moved).toBeCloseTo(3 + 4, 9);
  });

  test('補充は落ちている途中のものを捨てて、補充の距離だけを落とす', () => {
    const d = new Descent();
    run(d, 3, 1);
    d.startPenalty(3, 0.28);
    run(d, 2, 0);
    d.startRefill(12, 0.45);
    expect(d.refilling).toBe(true);
    const r = run(d, 60, 0);
    expect(r.moved).toBeCloseTo(12, 9);
    expect(r.penaltyLandings).toBe(0);
    expect(r.refillLandings).toBe(1);
    expect(d.refilling).toBe(false);
  });

  test('補充にペナルティが重なると、合わせた距離をペナルティとして落とし、着地はペナルティと補充の両方として知らせる', () => {
    const d = new Descent();
    d.startRefill(12, 0.45);
    d.startPenalty(3, 0.28);
    expect(d.refilling).toBe(true);
    const r = run(d, 60, 0);
    expect(r.moved).toBeCloseTo(15, 9);
    expect(r.penaltyLandings).toBe(1);
    expect(r.refillLandings).toBe(1);
    expect(d.refilling).toBe(false);
  });

  test('1 ステップで動かす距離には上限があり、超えた分は次へ持ち越す', () => {
    const d = new Descent();
    d.startPenalty(30, 0);
    const moves: number[] = [];
    for (let i = 0; i < 10; i++) moves.push(d.advance(STEP_DT, 0, ROW, STEP_SECONDS).delta);
    for (const m of moves) expect(m).toBeLessThanOrEqual(MAX_FIELD_MOVE_PER_STEP);
    expect(moves.reduce((a, b) => a + b, 0)).toBeCloseTo(30, 9);
  });

  test('落下時間が 0 なら、その場で着地する', () => {
    const d = new Descent();
    const r = d.advance(STEP_DT, 1, ROW, 0);
    expect(r.delta).toBe(ROW);
    expect(r.stepLanded).toBe(true);
  });
});
