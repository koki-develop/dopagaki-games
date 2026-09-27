import { describe, expect, test } from 'bun:test';
import { AudioEngine } from '../../juice/audio/engine.ts';
import { FlashLimiter } from '../../juice/flash.ts';
import { sanitizeTuning, snapshotTuning, tuning } from './config.ts';
import type { SimConfig } from './config.ts';
import { Run } from './run.ts';
import type { RunServices } from './run.ts';
import type { StageDef } from './sim/stage-parse.ts';
import { Bgm } from './sounds/bgm.ts';
import { STAGES } from './stages/stages.ts';
import type { RunMode, RunResult } from './types.ts';

const services = (inputNow = () => 0): RunServices => {
  const audio = new AudioEngine(() => null);
  return {
    audio,
    bgm: new Bgm(audio),
    flashes: new FlashLimiter(3, 1),
    particles: { emit: () => {} },
    debris: { emit: () => {} },
    vibrate: () => {},
    inputNow,
  };
};

/** ブロックがすぐに危険ラインへ届く調整値（ゲームオーバーまでを短く確かめる） */
const fastDescent = (): SimConfig => sanitizeTuning({ ...structuredClone(tuning), endless: { ...tuning.endless, descentStart: 60 } });

/** パドルの真上の 2 個だけのステージ。発射したボールが数秒でクリアする */
const SHORT_STAGE: StageDef = { id: 'short', name: 'SHORT', rows: ['.....oo.....'] };

type CreateOptions = { mode?: RunMode; previousBest?: number; presentOffset?: number; config?: SimConfig; inputNow?: () => number };

const create = (opts: CreateOptions = {}) =>
  new Run({
    id: 1,
    mode: opts.mode ?? { kind: 'endless' },
    stages: [SHORT_STAGE, ...STAGES],
    previousBest: opts.previousBest ?? 0,
    seed: 42,
    config: opts.config ?? snapshotTuning(),
    presentOffset: opts.presentOffset ?? 0,
    services: services(opts.inputNow),
  });

/** 結果（まだなら null）。skip() の前後で読み直すために関数にする */
const finishedOf = (run: Run): RunResult | null => run.signals.finished;

/** 60fps で 1 フレーム進める。乗っているボールは発射し、パドルは一番低い下向きのボールの下へ動かす */
function playFrame(run: Run, frame: number): void {
  if (run.sim.attached) run.input.latchLaunch();
  const b = run.sim.balls;
  let lowest = Infinity;
  for (let i = 0; i < b.count; i++) {
    if (b.dy[i] < 0 && b.y[i] < lowest) {
      lowest = b.y[i];
      run.input.moveTo(b.x[i]);
    }
  }
  run.advance(1 / 60, (frame + 1) / 60, 1);
}

/** 勝敗が決まるまで進め、進めたフレーム数を返す */
function playUntilEnding(run: Run, maxFrames = 60 * 60): number {
  for (let frame = 0; frame < maxFrames; frame++) {
    playFrame(run, frame);
    if (!Number.isNaN(run.signals.endingAt)) return frame + 1;
  }
  throw new Error('the run did not end');
}

describe('Run', () => {
  test('present はプレイが始まったときの present に世界時間を足したもので、戻らない', () => {
    const run = create({ presentOffset: 250 });
    expect(run.frameTime.present).toBe(250);
    let last = 250;
    let real = 0;
    for (let i = 0; i < 90; i++) {
      real += 1 / 60;
      const ft = run.advance(1 / 60, real, 1);
      expect(ft.present).toBeCloseTo(250 + ft.world, 9);
      expect(ft.world).toBeCloseTo(run.sim.time + run.alpha / 120, 9);
      expect(ft.present).toBeGreaterThanOrEqual(last);
      last = ft.present;
    }
    expect(run.sim.time).toBeCloseTo(1.5, 6);
  });

  test('1 フレームで進める固定ステップは、フレーム間隔の上限（0.1 秒）ぶんまで', () => {
    const run = create();
    run.advance(0.1, 0.1, 1);
    expect(run.sim.time).toBeCloseTo(0.1, 9);
    run.advance(0.5, 0.6, 1);
    expect(run.sim.time).toBeCloseTo(0.2, 9);
  });

  test('HUD の値は作った時点で埋まっていて、残機の最大は調整値の残機', () => {
    const run = create({ mode: { kind: 'stage', index: 1 }, previousBest: 1234 });
    expect(run.hud).toMatchObject({ runId: 1, score: 0, best: 1234, newBest: false, lives: tuning.stage.lives, maxLives: tuning.stage.lives });
  });

  test('存在しないステージは作らない', () => {
    expect(() => create({ mode: { kind: 'stage', index: 999 } })).toThrow();
  });

  test('ゲームオーバー: 勝敗が決まった知らせの 1.4 秒後に結果が 1 回だけ届き、その後は変わらない', () => {
    const run = create({ config: fastDescent(), previousBest: 0 });
    const endingFrame = playUntilEnding(run);
    let finishedFrame = -1;
    for (let frame = endingFrame; frame < endingFrame + 300; frame++) {
      playFrame(run, frame);
      if (finishedFrame < 0 && run.signals.finished) finishedFrame = frame + 1;
    }
    expect((finishedFrame - endingFrame) / 60).toBeCloseTo(1.4, 1);
    const result = run.signals.finished;
    expect(result).toEqual({ mode: { kind: 'endless' }, cleared: false, score: run.sim.score, previousBest: 0, newBest: run.sim.score > 0 });
    for (let frame = 0; frame < 120; frame++) playFrame(run, endingFrame + 300 + frame);
    expect(run.signals.finished).toBe(result);
    expect(run.skip()).toBe(false);
  });

  test('勝敗が決まった時刻は、入力の押した時刻と同じ時計で測る', () => {
    let now = 5000;
    const run = create({ config: fastDescent(), inputNow: () => now });
    for (let frame = 0; Number.isNaN(run.signals.endingAt) && frame < 3600; frame++) {
      now += 1 / 60;
      playFrame(run, frame);
    }
    expect(run.signals.endingAt).toBe(now);
  });

  test('ステージクリア: 見届けても、フィナーレの途中で飛ばしても、最終スコアと結果は同じ', () => {
    const stage: RunMode = { kind: 'stage', index: 0 };
    const watched = create({ mode: stage, previousBest: 10 });
    expect(watched.skip()).toBe(false);
    const endingFrame = playUntilEnding(watched);
    expect(watched.sim.phase).toBe('cleared');
    const bonusBalls = watched.sim.clearBonusRemaining;
    expect(bonusBalls).toBeGreaterThan(0);
    for (let frame = endingFrame; !watched.signals.finished && frame < endingFrame + 600; frame++) playFrame(watched, frame);
    const result = watched.signals.finished;
    if (!result) throw new Error('the finale did not finish');
    expect(result).toMatchObject({ mode: stage, cleared: true, previousBest: 10, newBest: true });
    expect(result.score).toBe(watched.sim.score);

    let skips = 0;
    for (const framesAfterEnding of [0, 10, 40, 70]) {
      const skipped = create({ mode: stage, previousBest: 10 });
      const end = playUntilEnding(skipped);
      for (let frame = end; frame < end + framesAfterEnding; frame++) playFrame(skipped, frame);
      if (finishedOf(skipped)) continue;
      expect(skipped.skip()).toBe(true);
      expect(finishedOf(skipped)).toEqual(result);
      expect(skipped.skip()).toBe(false);
      skips++;
    }
    expect(skips).toBeGreaterThanOrEqual(3);
  });

  test('捨てたプレイは演出を飛ばさず、節目も届かない', () => {
    const run = create({ config: fastDescent() });
    run.dispose();
    run.dispose();
    expect(run.skip()).toBe(false);
    for (let frame = 0; frame < 60 * 10; frame++) playFrame(run, frame);
    expect(run.sim.phase).toBe('over');
    expect(Number.isNaN(run.signals.endingAt)).toBe(true);
    expect(run.signals.finished).toBeNull();
  });
});
