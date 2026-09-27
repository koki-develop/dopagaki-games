import { describe, expect, test } from 'bun:test';
import { AudioEngine } from '../../../juice/audio/engine.ts';
import { MockAudioContext } from '../../../juice/audio/mock-audio.test-support.ts';
import type { MockFilter, MockGain, MockParam, MockSource } from '../../../juice/audio/mock-audio.test-support.ts';
import type { IntervalTimer } from '../../../juice/audio/sequencer.ts';
import { Bgm } from './bgm.ts';

class FakeTimer implements IntervalTimer {
  fn: (() => void) | null = null;
  /** シーケンサーが動いているか（タイマーが仕掛けられているか） */
  get running(): boolean {
    return this.fn !== null;
  }

  set(fn: () => void): unknown {
    this.fn = fn;
    return 1;
  }
  clear(): void {
    this.fn = null;
  }
}

type Nodes = {
  filter: MockFilter;
  kick: MockGain;
  bass: MockGain;
  hat: MockGain;
  pad: MockGain;
  riserGain: MockGain;
  riserFilter: MockFilter;
  riserSrc: MockSource;
  riserOsc: MockSource;
  riserOscGain: MockGain;
};

function setup() {
  const ctx = new MockAudioContext();
  const engine = new AudioEngine(() => ctx.asContext());
  engine.unlock();
  const timer = new FakeTimer();
  const bgm = new Bgm(engine, timer);
  const internals = bgm as unknown as { nodes: Nodes | null; seq: { upcomingStep: number } };
  /** 時計を seconds 秒進めながら、25ms ごとにシーケンサーを動かす */
  const run = (seconds: number) => {
    const end = ctx.currentTime + seconds;
    while (ctx.currentTime < end - 1e-9) {
      ctx.currentTime = Math.min(end, ctx.currentTime + 0.025);
      timer.fn?.();
    }
  };
  return { ctx, engine, timer, bgm, internals, run };
}

/** 初期値と、それを持つ AudioParam */
function initialParams(n: Nodes): [MockParam, number][] {
  return [
    [n.filter.frequency, 18000],
    [n.kick.gain, 1],
    [n.bass.gain, 1],
    [n.hat.gain, 0],
    [n.pad.gain, 0],
    [n.riserGain.gain, 0],
    [n.riserFilter.frequency, 300],
    [n.riserOsc.frequency, 110],
    [n.riserOscGain.gain, 0],
  ];
}

describe('Bgm', () => {
  test('restart() はすべての値を今すぐ初期値へ戻し、ステップ 0 から鳴らす', () => {
    const { ctx, bgm, timer, internals, run } = setup();
    bgm.start();
    run(3);
    bgm.setTier(4);
    bgm.setRiser(0.8);
    bgm.setOpenness(0.1, 1);
    run(0.5);
    const scheduled = ctx.sources.filter((s) => s.startAt > ctx.currentTime);
    expect(scheduled.length).toBeGreaterThan(0);
    const t = ctx.currentTime;
    bgm.restart();
    const n = internals.nodes!;
    for (const [param, value] of initialParams(n)) {
      expect(param.events.slice(-2)).toEqual([
        { kind: 'cancel', time: t },
        { kind: 'set', value, time: t },
      ]);
    }
    expect(internals.seq.upcomingStep).toBe(0);
    expect(timer.running).toBe(true);
    // 予約済みの前のプレイの音は鳴らさない
    for (const s of scheduled) expect(s.stopAt).toBeLessThan(s.startAt);
    // ステップ 0 のキックが今から鳴る
    const before = ctx.sources.length;
    run(0.1);
    const kick = ctx.sources.slice(before).find((s) => s.kind === 'oscillator');
    expect(kick).toBeDefined();
    expect(kick!.startAt - t).toBeLessThan(0.1);
  });

  test('pause() はシーケンサーを止め、ハイハット・パッド・ライザーを今すぐ消す。resume() で戻す', () => {
    const { ctx, bgm, timer, internals, run } = setup();
    bgm.start();
    bgm.setTier(4);
    bgm.setRiser(1);
    run(1);
    const scheduled = ctx.sources.filter((s) => s.startAt > ctx.currentTime);
    const t = ctx.currentTime;
    bgm.pause();
    const createdBeforePause = ctx.sources.length;
    const n = internals.nodes!;
    expect(timer.running).toBe(false);
    for (const g of [n.hat, n.pad, n.riserGain, n.riserOscGain]) {
      expect(g.gain.events.at(-1)).toEqual({ kind: 'linear', value: 0, time: t + 0.015 });
    }
    for (const s of scheduled) expect(s.stopAt).toBeLessThanOrEqual(t + 0.015 + 1e-9);

    // 一時停止中に高まりが変わっても、音量は 0 のまま
    const riserEvents = n.riserGain.gain.events.length;
    bgm.setRiser(0.5);
    bgm.setTier(1);
    expect(n.riserGain.gain.events.length).toBe(riserEvents);
    expect(n.hat.gain.lastTarget).toBe(0);
    run(1);
    expect(ctx.sources.length).toBe(createdBeforePause);

    bgm.resume();
    expect(timer.running).toBe(true);
    expect(n.riserGain.gain.lastTarget).toBeCloseTo(0.5 * 0.5 * 0.35, 9);
    expect(n.riserOscGain.gain.lastTarget).toBeCloseTo(0.5 * 0.5 * 0.08, 9);
    expect(n.hat.gain.lastTarget).toBe(1);
    expect(n.pad.gain.lastTarget).toBe(0);
  });

  test('一時停止中は beatPosition() が進まない', () => {
    const { ctx, bgm, run } = setup();
    bgm.start();
    run(1);
    bgm.pause();
    const b = bgm.beatPosition();
    ctx.currentTime += 3;
    expect(bgm.beatPosition()).toBeCloseTo(b, 9);
    bgm.start();
    expect(bgm.beatPosition()).toBeCloseTo(b, 9);
  });

  test('dispose() はライザーの音源を止めてノードを切り離し、以後は何も鳴らさない', () => {
    const { ctx, bgm, timer, internals, run } = setup();
    bgm.start();
    run(0.5);
    const n = internals.nodes!;
    bgm.dispose();
    expect(n.riserSrc.stopCalls).toBe(1);
    expect(n.riserOsc.stopCalls).toBe(1);
    for (const node of [n.filter, n.kick, n.bass, n.hat, n.pad, n.riserGain, n.riserFilter, n.riserSrc, n.riserOsc, n.riserOscGain]) {
      expect(node.disconnected).toBe(true);
    }
    expect(timer.running).toBe(false);
    ctx.resetCounts();
    bgm.start();
    bgm.resume();
    bgm.restart();
    bgm.setRiser(1);
    bgm.setTier(4);
    run(1);
    expect(ctx.nodes).toBe(0);
    expect(timer.running).toBe(false);
  });

  test('setTier / setRiser / setOpenness は値が変わらなければ何も書き込まない', () => {
    const { bgm, internals } = setup();
    bgm.start();
    const n = internals.nodes!;
    const count = () => initialParams(n).reduce((sum, [p]) => sum + p.events.length, 0);
    bgm.setTier(2);
    bgm.setRiser(0.4);
    bgm.setOpenness(0.5, 1);
    const written = count();
    for (let i = 0; i < 60; i++) {
      bgm.setTier(2);
      bgm.setRiser(0.4 + 1e-5);
      bgm.setOpenness(0.5, 1);
    }
    expect(count()).toBe(written);
    // 0 へ戻すのは、差が小さくても必ず書き込む
    bgm.setRiser(0);
    expect(count()).toBeGreaterThan(written);
  });

  test('ライザーを使い始めると、高まりが 0 でも全体のフィルタはライザーの基準（9 kHz）になる。restart() で使っていない状態へ戻る', () => {
    const { bgm, internals } = setup();
    bgm.start();
    const n = internals.nodes!;
    expect(n.filter.frequency.lastTarget).toBe(18000);
    bgm.setRiser(0);
    expect(n.filter.frequency.lastTarget).toBe(9000);
    bgm.restart();
    expect(n.filter.frequency.lastTarget).toBe(18000);
    bgm.setRiser(0);
    expect(n.filter.frequency.lastTarget).toBe(9000);
    // 使い始めは段階的に動かさず、今すぐ切り替える
    const last = n.filter.frequency.events[n.filter.frequency.events.length - 1];
    expect(last).toMatchObject({ kind: 'set' });
  });

  test('AudioContext ができる前に使い始めたライザーも、ノードを作ったときにフィルタへ反映する', () => {
    const ctx = new MockAudioContext();
    const engine = new AudioEngine(() => ctx.asContext());
    const bgm = new Bgm(engine, new FakeTimer());
    bgm.setRiser(0);
    engine.unlock();
    bgm.start();
    const n = (bgm as unknown as { nodes: Nodes }).nodes;
    expect(n.filter.frequency.lastTarget).toBe(9000);
  });

  test('AudioContext ができる前の設定も、ノードを作ったときに反映する', () => {
    const ctx = new MockAudioContext();
    const engine = new AudioEngine(() => ctx.asContext());
    const bgm = new Bgm(engine, new FakeTimer());
    bgm.setTier(4);
    engine.unlock();
    bgm.start();
    const n = (bgm as unknown as { nodes: Nodes }).nodes;
    expect(n.hat.gain.lastTarget).toBe(1);
    expect(n.pad.gain.lastTarget).toBe(1);
  });

  test('パッドのノコギリ波は 1 つのエンベロープを共有する', () => {
    const { ctx, bgm, run } = setup();
    bgm.setTier(4);
    const before = ctx.sources.length;
    bgm.start();
    run(0.03);
    const saws = ctx.sources.slice(before).filter((s) => s.type === 'sawtooth' && s.outputs[0] !== undefined);
    const padSaws = saws.filter((s) => s.detune.value === 11 || s.detune.value === -11);
    expect(padSaws.length).toBe(10);
    expect(new Set(padSaws.map((s) => s.outputs[0])).size).toBe(1);
  });
});
