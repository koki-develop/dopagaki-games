import { describe, expect, test } from 'bun:test';
import { Sequencer } from './sequencer.ts';
import type { IntervalTimer, SequencerClock } from './sequencer.ts';

class FakeClock implements SequencerClock {
  t = 10;
  running = true;
  lat = 0.02;
  now(): number {
    return this.t;
  }
  latency(): number {
    return this.lat;
  }
}

class FakeTimer implements IntervalTimer {
  fn: (() => void) | null = null;
  set(fn: () => void): unknown {
    this.fn = fn;
    return 1;
  }
  clear(): void {
    this.fn = null;
  }
  fire(): void {
    this.fn?.();
  }
}

function setup() {
  const clock = new FakeClock();
  const timer = new FakeTimer();
  const steps: { step: number; time: number; now: number }[] = [];
  const seq = new Sequencer(clock, 128, 4, (step, time) => steps.push({ step, time, now: clock.t }), timer);
  /** 時計を seconds 秒進めながら、25ms ごとにタイマーを動かす */
  const run = (seconds: number) => {
    const end = clock.t + seconds;
    while (clock.t < end - 1e-9) {
      clock.t = Math.min(end, clock.t + 0.025);
      timer.fire();
    }
  };
  return { clock, timer, seq, steps, run };
}

describe('Sequencer', () => {
  test('ステップを一定間隔で先に予約する', () => {
    const { seq, steps, run } = setup();
    seq.start();
    run(2);
    expect(steps[0].step).toBe(0);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].step).toBe(steps[i - 1].step + 1);
      expect(steps[i].time - steps[i - 1].time).toBeCloseTo(seq.stepDuration, 9);
    }
    for (const s of steps) expect(s.time).toBeGreaterThanOrEqual(s.now);
  });

  test('タイマーが少し遅れても、過ぎたステップをまとめて鳴らさない', () => {
    const { clock, timer, seq, steps, run } = setup();
    seq.start();
    run(1);
    const before = steps.length;
    clock.t += 0.2;
    timer.fire();
    const burst = steps.slice(before);
    for (const s of burst) expect(s.time).toBeGreaterThanOrEqual(clock.t);
    // 同じ時刻に重ならず、間隔は保つ
    for (let i = 1; i < burst.length; i++) expect(burst[i].time - burst[i - 1].time).toBeCloseTo(seq.stepDuration, 9);
    expect(burst.length).toBeLessThanOrEqual(Math.ceil(0.12 / seq.stepDuration) + 1);
  });

  test('長い空白のあとは現在から数え直し、溜まったステップを鳴らさない', () => {
    const { clock, timer, seq, steps, run } = setup();
    seq.start();
    run(1);
    const before = steps.length;
    const lastStep = steps.at(-1)!.step;
    clock.t += 5;
    timer.fire();
    const after = steps.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThanOrEqual(2);
    expect(after[0].step).toBe(lastStep + 1);
    for (const s of after) expect(s.time).toBeGreaterThanOrEqual(clock.t);
  });

  test('AudioContext が止まって動き出しても、まとめて鳴らさない', () => {
    const { clock, timer, seq, steps, run } = setup();
    seq.start();
    run(1);
    clock.running = false;
    timer.fire();
    clock.t += 3;
    timer.fire();
    clock.running = true;
    const before = steps.length;
    timer.fire();
    run(0.5);
    const after = steps.slice(before);
    for (const s of after) expect(s.time).toBeGreaterThanOrEqual(s.now);
    for (let i = 1; i < after.length; i++) expect(after[i].time - after[i - 1].time).toBeCloseTo(seq.stepDuration, 9);
  });

  test('止めている間は beatPosition() が止まり、再開してもつながる', () => {
    const { clock, seq, steps, run } = setup();
    seq.start();
    run(1.013);
    const atStop = seq.beatPosition();
    seq.stop();
    const stepAtStop = seq.upcomingStep;
    clock.t += 7;
    expect(seq.beatPosition()).toBeCloseTo(atStop, 9);
    seq.start();
    expect(seq.beatPosition()).toBeCloseTo(atStop, 9);
    const resumedAt = clock.t;
    run(1);
    // 止めたステップから、止めたときと同じ間合いで続ける
    const first = steps.find((s) => s.step === stepAtStop)!;
    expect(first.time).toBeGreaterThan(resumedAt);
    expect(seq.beatPosition()).toBeCloseTo(atStop + 1 / (60 / 128), 6);
  });

  test('reset() でステップ 0 へ戻る。鳴らしている間なら今からステップ 0 を鳴らす', () => {
    const { clock, seq, steps, run } = setup();
    seq.start();
    run(1);
    const before = steps.length;
    seq.reset();
    run(0.05);
    const after = steps.slice(before);
    expect(after[0].step).toBe(0);
    expect(after[0].time).toBeGreaterThanOrEqual(clock.t - 0.05);
    seq.stop();
    seq.reset();
    expect(seq.upcomingStep).toBe(0);
  });
});
