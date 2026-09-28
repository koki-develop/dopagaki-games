import { describe, expect, test } from 'bun:test';
import { STEP_HZ, sanitizeTuning, tuning } from '../config.ts';
import { Sim } from './sim.ts';
import type { SimInput, SimMode } from './sim.ts';
import { MIXED, PLAIN, autoplayInput } from './sim.test-support.ts';

const config = sanitizeTuning(tuning);

function play(mode: SimMode, seed: number, steps: number, input: (sim: Sim, k: number) => SimInput) {
  const sim = new Sim({ mode, seed, config });
  let k = 0;
  for (; k < steps && sim.phase === 'playing'; k++) {
    sim.step(input(sim, k));
    sim.events.clear();
  }
  return { sim, steps: k };
}

describe('決定性', () => {
  test('同じシードと同じ入力なら、2 つの sim は毎ステップ同じ状態になる', () => {
    const a = new Sim({ mode: { kind: 'endless' }, seed: 1234, config });
    const b = new Sim({ mode: { kind: 'endless' }, seed: 1234, config });
    for (let k = 0; k < 6000; k++) {
      const input = autoplayInput(a, k);
      a.step(input);
      b.step(input);
      expect(b.events.length).toBe(a.events.length);
      expect(b.events.signals).toBe(a.events.signals);
      a.events.clear();
      b.events.clear();
      if (k % 100 !== 0) continue;
      expect(b.score).toBe(a.score);
      expect(b.balls.count).toBe(a.balls.count);
      expect(b.balls.x.subarray(0, a.balls.count)).toEqual(a.balls.x.subarray(0, a.balls.count));
      expect(b.balls.dy.subarray(0, a.balls.count)).toEqual(a.balls.dy.subarray(0, a.balls.count));
      expect(b.blocks.type).toEqual(a.blocks.type);
      expect(b.blocks.hp).toEqual(a.blocks.hp);
      expect(b.blocks.lowestRowY).toBe(a.blocks.lowestRowY);
    }
  });

  test('シードが違えば、エンドレスの配置が変わる', () => {
    const a = new Sim({ mode: { kind: 'endless' }, seed: 1, config });
    const b = new Sim({ mode: { kind: 'endless' }, seed: 2, config });
    expect(b.blocks.type).not.toEqual(a.blocks.type);
  });

  // 以下の値は、この実装で記録した結果。sim の規則を変えたら、変わった理由を確かめてから更新する
  test('既知の入力列の結果（エンドレス・自動プレイ 100 秒）', () => {
    const { sim, steps } = play({ kind: 'endless' }, 20260928, 12000, autoplayInput);
    expect(steps).toBe(12000);
    expect(sim.phase).toBe('playing');
    expect(sim.score).toBe(1361233);
    expect(sim.ballCount).toBe(500);
    expect(sim.blocks.liveCount).toBe(56);
    expect(sim.time).toBeCloseTo(100, 9);
  });

  test('既知の入力列の結果（エンドレス・パドルを往復させるだけでゲームオーバー）', () => {
    const { sim, steps } = play({ kind: 'endless' }, 1234, 200000, (s, i) => ({
      paddleTargetX: 4.5 + Math.sin(i * 0.02) * 3.5,
      launch: s.attached,
    }));
    expect(steps).toBe(1376);
    expect(sim.phase).toBe('over');
    expect(sim.score).toBe(98);
    expect(sim.ballCount).toBe(2);
    expect(sim.blocks.liveCount).toBe(352);
    expect(sim.time).toBeCloseTo(1376 / STEP_HZ, 9);
  });

  test('既知の入力列の結果（ステージをクリア）', () => {
    const { sim, steps } = play(MIXED, 7, 12000, autoplayInput);
    expect(steps).toBe(1491);
    expect(sim.phase).toBe('cleared');
    expect(sim.score).toBe(24360);
    expect(sim.ballCount).toBe(375);
    expect(sim.clearBonusRemaining).toBe(375);
    expect(sim.lives).toBe(3);
    expect(sim.time).toBeCloseTo(1491 / STEP_HZ, 9);
  });
});

describe('発射角と描画のフレームレート', () => {
  /**
   * 描画のフレームレート hz で指を動かしてから離したときの発射角（度、右が正）。
   * フレームごとに届く指の位置を、そのフレームで進める固定ステップへ線形に割り振り、
   * 指を離したことは、それを受け取ったフレームの次のステップで sim に渡す。
   * interpolate が false なら、フレームの移動をすべて最初のステップで反映する。
   */
  function launchDeg(hz: number, interpolate: boolean): number {
    const sim = new Sim({ mode: PLAIN, seed: 1, config });
    const stepsPerFrame = STEP_HZ / hz;
    const start = sim.paddleX;
    const speed = 6;
    const moveFrom = 0.2;
    const release = 0.7;
    const finger = (t: number) => start + speed * (Math.min(Math.max(t, moveFrom), release) - moveFrom);
    let prev = finger(0);
    let launchNext = false;
    for (let frame = 0; sim.attached; frame++) {
      if (frame > 10 * hz) throw new Error('did not launch');
      const end = (frame + 1) / hz;
      const target = finger(end);
      for (let j = 0; j < stepsPerFrame; j++) {
        const x = interpolate ? prev + ((target - prev) * (j + 1)) / stepsPerFrame : target;
        sim.step({ paddleTargetX: x, launch: launchNext });
        launchNext = false;
      }
      prev = target;
      if (end >= release) launchNext = true;
    }
    return (Math.atan2(sim.balls.dx[0], sim.balls.dy[0]) * 180) / Math.PI;
  }

  test('ステップに割り振った入力なら、30 / 60 / 120Hz で発射角が一致する', () => {
    const at120 = launchDeg(120, true);
    expect(at120).toBeGreaterThan(5);
    expect(launchDeg(60, true)).toBeCloseTo(at120, 9);
    expect(launchDeg(30, true)).toBeCloseTo(at120, 9);
  });

  test('フレームの移動を 1 ステップにまとめて渡すと、フレームレートで発射角が変わる', () => {
    expect(Math.abs(launchDeg(30, false) - launchDeg(120, false))).toBeGreaterThan(0.1);
  });
});
