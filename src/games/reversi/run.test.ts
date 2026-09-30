import { describe, expect, test } from 'bun:test';
import { AudioEngine } from '../../juice/audio/engine.ts';
import { FlashLimiter } from '../../juice/flash.ts';
import { Rng } from '../../shared/rng.ts';
import { chooseMove } from './ai/cpu.ts';
import { COMBO_WINDOW } from './combo.ts';
import { MIN_THINK } from './config.ts';
import { BLACK, parseSquare, positionFromRows, SQUARES, WHITE } from './rules/position.ts';
import type { Color } from './rules/position.ts';
import { Run } from './run.ts';
import type { RunServices } from './run.ts';
import { sheetOf } from './result.test-support.ts';
import { SCORE } from './scoring.ts';
import { createReversiBgm } from './sounds/bgm.ts';
import type { Callout, RunResult } from './types.ts';

const DT = 1 / 60;

function services(callouts: Callout[] = [], announcements: string[] = []): RunServices {
  const audio = new AudioEngine(() => null);
  return {
    audio,
    bgm: createReversiBgm(audio),
    flashes: new FlashLimiter(3, 1),
    particles: { emit: () => {} },
    vibrate: () => {},
    callout: (c) => callouts.push(c),
    announce: (t) => announcements.push(t),
    inputNow: () => 0,
  };
}

/** 人の手番が来たら CPU と同じ選び方ですぐに打ち、結果が確定するまで 60fps で進める */
function autoplay(human: Color, seed: number) {
  const callouts: Callout[] = [];
  const announcements: string[] = [];
  const run = new Run({ id: 1, setup: { human }, start: null, bestScore: 0, seed, real: 0, presentOffset: 0, services: services(callouts, announcements) });
  const rng = new Rng(seed + 1);
  let real = 0;
  let humanMoves = 0;
  for (let i = 0; i < 60 * 60 * 10 && !run.signals.finished; i++) {
    real += DT;
    run.advance(DT, real, 1);
    if (run.humanTurn) {
      humanMoves++;
      run.release(chooseMove(run.match.position, rng));
    }
  }
  const result: RunResult | null = run.signals.finished;
  if (!result) throw new Error('the run did not finish');
  run.dispose();
  return { run, result, callouts, announcements, humanMoves };
}

describe('Run', () => {
  test('コンボが途切れなくても、盤が埋まる前に終局したらフルコンボにしない', () => {
    // 黒（人）が c4 に打つと白が 0 になって、空きマスを残して終局する
    const start = positionFromRows(['........', '........', '........', '...OOOX.', '..OO....', '..O.O...', '..X..X..', '........'], BLACK);
    const run = new Run({ id: 1, setup: { human: BLACK }, start, bestScore: 0, seed: 1, real: 0, presentOffset: 0, services: services() });
    let real = 0;
    while (!run.humanTurn) {
      real += DT;
      run.advance(DT, real, 1);
    }
    run.release(parseSquare('c4'));
    while (!run.signals.finished) {
      real += DT;
      run.advance(DT, real, 1);
    }
    const result = run.signals.finished;
    expect([result.maxCombo, result.perfect, result.fullCombo]).toEqual([1, true, false]);
    expect(result.score.comboPoints).toBe(SCORE.maxCombo);
    run.dispose();
  });

  test('対局の最初の手は、すぐに打っても早打ちにしない。2 手目からは早打ちになる', () => {
    const callouts: Callout[] = [];
    const run = new Run({ id: 1, setup: { human: BLACK }, start: null, bestScore: 0, seed: 3, real: 0, presentOffset: 0, services: services(callouts) });
    const rng = new Rng(4);
    let real = 0;
    for (let moves = 0; moves < 3; ) {
      real += DT;
      run.advance(DT, real, 1);
      if (run.humanTurn) {
        run.release(chooseMove(run.match.position, rng));
        moves++;
      }
    }
    while (callouts.filter((c) => c.kind === 'score').length < 3) {
      real += DT;
      run.advance(DT, real, 1);
    }
    expect(callouts.flatMap((c) => (c.kind === 'score' ? [c.quick] : []))).toEqual([false, true, true]);
    run.dispose();
  });

  test('コンボが途切れた後に打った手は新しいコンボの 1 手目になり、続けて素早く打つと 2、3 と積む', () => {
    const callouts: Callout[] = [];
    const run = new Run({ id: 1, setup: { human: BLACK }, start: null, bestScore: 0, seed: 3, real: 0, presentOffset: 0, services: services(callouts) });
    const rng = new Rng(4);
    let real = 0;
    const tick = () => {
      real += DT;
      run.advance(DT, real, 1);
    };
    /** 人の手番を待ち、idle 秒（世界時間）放っておいてから打つ */
    const humanPlays = (idle: number) => {
      while (!run.humanTurn) tick();
      for (let t = 0; t < idle; t += DT) tick();
      run.release(chooseMove(run.match.position, rng));
    };
    const multipliers = () => callouts.flatMap((c) => (c.kind === 'score' ? [c.multiplier] : []));
    humanPlays(0);
    humanPlays(0);
    humanPlays(COMBO_WINDOW + 0.5);
    humanPlays(0);
    humanPlays(0);
    while (!run.humanTurn) tick();
    expect(callouts.flatMap((c) => (c.kind === 'combo' ? [c.count] : []))).toEqual([2, 2, 3]);
    expect(multipliers()).toEqual([1, 1.1, 1, 1.1, 1.2]);
    run.dispose();
  });

  test('始めたときの時刻は、セッションの実時間と present の時刻から続ける', () => {
    const run = new Run({ id: 1, setup: { human: BLACK }, start: null, bestScore: 0, seed: 1, real: 12.5, presentOffset: 40, services: services() });
    expect(run.frameTime).toMatchObject({ real: 12.5, world: 0, present: 40 });
    run.advance(1 / 60, 12.5 + 1 / 60, 1);
    expect(run.frameTime.real).toBeCloseTo(12.5 + 1 / 60, 9);
    run.dispose();
  });

  test('始まりの演出の間は打てず、終わると手番の側が動き出す', () => {
    const run = new Run({ id: 1, setup: { human: BLACK }, start: null, bestScore: 0, seed: 1, real: 0, presentOffset: 0, services: services() });
    expect([run.humanTurn, run.activeSide]).toEqual([false, null]);
    let real = 0;
    while (!run.humanTurn) {
      real += DT;
      run.advance(DT, real, 1);
    }
    expect(run.activeSide).toBe('human');
    run.dispose();
  });

  test('CPU の手番の間は、盤のマスを光らせない（考えている候補を見せない）', () => {
    const run = new Run({ id: 1, setup: { human: WHITE }, start: null, bestScore: 0, seed: 1, real: 0, presentOffset: 0, services: services() });
    let real = 0;
    while (run.activeSide !== 'cpu') {
      real += DT;
      run.advance(DT, real, 1);
    }
    let maxHover = 0;
    while (run.activeSide === 'cpu') {
      real += DT;
      run.advance(DT, real, 1);
      maxHover = Math.max(maxHover, run.fx.hover);
    }
    expect(maxHover).toBe(0);
    run.dispose();
  });

  test('CPU は最短の思考時間（実時間）を待ってから打つ', () => {
    const announcements: string[] = [];
    const run = new Run({ id: 1, setup: { human: WHITE }, start: null, bestScore: 0, seed: 1, real: 0, presentOffset: 0, services: services([], announcements) });
    let real = 0;
    while (run.activeSide !== 'cpu') {
      real += DT;
      run.advance(DT, real, 1);
    }
    const since = real;
    while (announcements.length === 0) {
      real += DT;
      run.advance(DT, real, 1);
    }
    expect(real - since).toBeGreaterThanOrEqual(MIN_THINK - 1e-9);
    expect(real - since).toBeLessThan(MIN_THINK + 2 * DT);
    run.dispose();
  });

  test('盤に出した得点の文字の合計が、結果の手の点と早打ちの点の合計と一致し、人の手ごとに 1 回ずつ出る', () => {
    for (const human of [BLACK, WHITE] as const) {
      const { run, result, callouts, humanMoves } = autoplay(human, 3);
      const scores = callouts.flatMap((c) => (c.kind === 'score' ? [c.points] : []));
      expect(scores).toHaveLength(humanMoves);
      expect(scores.reduce((a, b) => a + b, 0)).toBe(result.score.moves + result.score.quick);
      // すぐ打ち続けたので、どの手も早打ち（黒の最初の手は除く）
      const quick = humanMoves - (human === BLACK ? 1 : 0);
      expect(result.quickCount).toBe(quick);
      expect(callouts.filter((c) => c.kind === 'score' && c.quick)).toHaveLength(quick);
      expect(result.score.quick).toBe(quick * SCORE.quick);
      const humanPassed = callouts.some((c) => c.kind === 'pass' && c.who === 'human');
      // フルコンボは、盤が埋まるまで一度も途切れなかったときだけ
      const filled = result.human + result.cpu === SQUARES;
      expect(result.fullCombo).toBe(!humanPassed && filled);
      if (result.fullCombo) expect(result.score.comboPoints).toBe(SCORE.fullCombo);
      expect(result.score).toEqual(sheetOf({ moves: result.score.moves, quick: result.score.quick, fullCombo: result.fullCombo, discs: result.human, won: result.outcome === 'win', perfect: result.perfect, maxCombo: result.maxCombo }));
      // 儀式を終えた HUD の得点は、対局中の得点に石の点を足した値
      expect(run.hud.score).toBe(result.score.moves + result.score.quick + result.score.discPoints);
    }
  });

  test('同じ乱数の種と操作なら、同じ結果になる', () => {
    const a = autoplay(BLACK, 11).result;
    const b = autoplay(BLACK, 11).result;
    expect(b).toEqual(a);
    expect(a).toMatchObject({ practice: false, newBest: false });
  });
});
