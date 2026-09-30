import { describe, expect, test } from 'bun:test';
import { LayeredBgm } from './bgm.ts';
import type { Arrangement } from './bgm.ts';
import { AudioEngine } from './engine.ts';
import { MockAudioContext } from './mock-audio.test-support.ts';
import type { MockFilter, MockGain, MockParam, MockSource } from './mock-audio.test-support.ts';
import type { IntervalTimer } from './sequencer.ts';
import { tone } from './synth.ts';

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

const LAYERS = 2;

/** 層 0 は常に鳴り、層 1 は段階 1 以上で入る。拍の頭で層 0、裏で層 1 を鳴らす。鳴らしたステップを steps に残す */
const arrangement = (steps: number[]): Arrangement => ({
  bpm: 120,
  stepsPerBeat: 2,
  layerCount: LAYERS,
  layerLevel: (layer, tier) => (layer === 0 ? 1 : tier >= 1 ? 0.8 : 0),
  layerTau: () => 1,
  play: (step, _time, _tier, voice) => {
    steps.push(step);
    const v = voice(0.2, 1, step % 2);
    if (v) tone(v, v.start, 'sine', 220, 0.002, 0.15, 0.5);
  },
});

type Riser = { gain: MockGain; filter: MockFilter; src: MockSource; osc: MockSource; oscGain: MockGain };

/** 偽の AudioContext の接続から、BGM の全体のフィルタと層を探す */
function mainNodes(ctx: MockAudioContext, engine: AudioEngine): { filter: MockFilter; layers: MockGain[] } {
  const input = engine.graph?.bgmInput as unknown as MockGain;
  const filter = ctx.filters.find((f) => f.outputs[0] === input);
  if (!filter) throw new Error('BGM のフィルタがない');
  return { filter, layers: ctx.gains.filter((g) => g.outputs[0] === filter).slice(0, LAYERS) };
}

/** いちばん新しく作られたライザー。作られていなければ null */
function latestRiser(ctx: MockAudioContext): Riser | null {
  const src = ctx.sources.findLast((s) => s.kind === 'bufferSource' && s.loop);
  const osc = ctx.sources.findLast((s) => s.kind === 'oscillator' && s.type === 'sawtooth');
  if (!src || !osc) return null;
  const filter = src.outputs[0] as unknown as MockFilter;
  return { src, filter, gain: filter.outputs[0] as unknown as MockGain, osc, oscGain: osc.outputs[0] as unknown as MockGain };
}

function setup() {
  const ctx = new MockAudioContext();
  const engine = new AudioEngine(() => ctx.asContext());
  engine.unlock();
  const timer = new FakeTimer();
  const steps: number[] = [];
  const bgm = new LayeredBgm(engine, arrangement(steps), timer);
  /** 時計を seconds 秒進めながら、25ms ごとにシーケンサーを動かす */
  const run = (seconds: number) => {
    const end = ctx.currentTime + seconds;
    while (ctx.currentTime < end - 1e-9) {
      ctx.currentTime = Math.min(end, ctx.currentTime + 0.025);
      timer.fn?.();
    }
  };
  const nodes = () => mainNodes(ctx, engine);
  const riser = () => latestRiser(ctx);
  return { ctx, engine, timer, bgm, steps, run, nodes, riser };
}

/** 開き具合 o のときの全体のフィルタの周波数 */
const opennessHz = (o: number) => 140 * (18000 / 140) ** o;

describe('LayeredBgm', () => {
  test('ステップごとに曲の中身を呼び、音を層へつなぐ', () => {
    const { ctx, bgm, run, nodes } = setup();
    bgm.setTier(1);
    bgm.start();
    run(1);
    const { layers } = nodes();
    const outs = new Set(ctx.gains.filter((g) => layers.includes(g.outputs[0] as MockGain)).map((g) => g.outputs[0]));
    expect(outs.size).toBe(2);
  });

  test('ライザーの音源は、setRiser を受け取るまで作らない', () => {
    const { bgm, run, riser } = setup();
    bgm.start();
    bgm.setTier(4);
    bgm.setOpenness(0.5, 1);
    run(2);
    expect(riser()).toBeNull();
    bgm.setRiser(0.3);
    const r = riser();
    expect(r).not.toBeNull();
    expect(r?.src.startAt).toBeGreaterThanOrEqual(0);
    expect(r?.gain.gain.lastTarget).toBeCloseTo(0.3 * 0.3 * 0.35, 9);
  });

  test('restart() はすべての値を今すぐ初期値へ戻し、ライザーを止めて、ステップ 0 から鳴らす', () => {
    const { ctx, bgm, timer, steps, run, nodes, riser } = setup();
    bgm.start();
    run(3);
    bgm.setTier(4);
    bgm.setRiser(0.8);
    bgm.setOpenness(0.1, 1);
    run(0.5);
    const scheduled = ctx.sources.filter((s) => s.startAt > ctx.currentTime);
    expect(scheduled.length).toBeGreaterThan(0);
    const r = riser();
    const t = ctx.currentTime;
    bgm.restart();
    const n = nodes();
    for (const [param, value] of [
      [n.filter.frequency, 18000],
      [n.layers[0].gain, 1],
      [n.layers[1].gain, 0],
    ] as [MockParam, number][]) {
      expect(param.events.slice(-2)).toEqual([
        { kind: 'cancel', time: t },
        { kind: 'set', value, time: t },
      ]);
    }
    // ライザーは素早く消してから止める
    expect(r?.gain.gain.valueAt(t + 0.015)).toBe(0);
    expect(r?.oscGain.gain.valueAt(t + 0.015)).toBe(0);
    expect(r?.src.stopAt).toBeCloseTo(t + 0.015, 9);
    expect(r?.osc.stopAt).toBeCloseTo(t + 0.015, 9);
    r?.osc.onended?.();
    expect(r?.gain.disconnected).toBe(true);
    expect(timer.running).toBe(true);
    // 予約済みの前のプレイの音は鳴らさない
    for (const s of scheduled) expect(s.stopAt).toBeLessThan(s.startAt);
    const before = ctx.sources.length;
    const stepsBefore = steps.length;
    run(0.1);
    expect(steps[stepsBefore]).toBe(0);
    const first = ctx.sources.slice(before).find((s) => s.kind === 'oscillator');
    expect(first).toBeDefined();
    expect(first!.startAt - t).toBeLessThan(0.1);
  });

  test('pause() はシーケンサーを止め、予約済みの音とライザーを今すぐ消す。層の音量には触れず、resume() でライザーを今の高まりへ戻す', () => {
    const { ctx, bgm, timer, run, nodes, riser } = setup();
    bgm.start();
    bgm.setTier(4);
    bgm.setRiser(1);
    run(1);
    const scheduled = ctx.sources.filter((s) => s.startAt > ctx.currentTime);
    const t = ctx.currentTime;
    const n = nodes();
    const r = riser()!;
    const layerEvents = n.layers.map((g) => g.gain.events.length);
    bgm.pause();
    const createdBeforePause = ctx.sources.length;
    expect(timer.running).toBe(false);
    for (const g of [r.gain, r.oscGain]) {
      expect(g.gain.events.at(-1)).toEqual({ kind: 'linear', value: 0, time: t + 0.015 });
    }
    for (const s of scheduled) expect(s.stopAt).toBeLessThanOrEqual(t + 0.015 + 1e-9);
    expect(n.layers.map((g) => g.gain.events.length)).toEqual(layerEvents);

    // 一時停止中に高まりが変わっても、ライザーの音量は 0 のまま。段階は層へそのまま反映する
    const riserEvents = r.gain.gain.events.length;
    bgm.setRiser(0.5);
    bgm.setTier(1);
    expect(r.gain.gain.events.length).toBe(riserEvents);
    expect(n.layers[1].gain.lastTarget).toBe(0.8);
    run(1);
    expect(ctx.sources.length).toBe(createdBeforePause);

    const beforeResume = n.layers.map((g) => g.gain.events.length);
    bgm.resume();
    expect(timer.running).toBe(true);
    expect(r.gain.gain.lastTarget).toBeCloseTo(0.5 * 0.5 * 0.35, 9);
    expect(r.oscGain.gain.lastTarget).toBeCloseTo(0.5 * 0.5 * 0.08, 9);
    // 再開した直後のステップを、層の音量の立ち上がりで弱めない
    expect(n.layers.map((g) => g.gain.events.length)).toEqual(beforeResume);
  });

  test('一時停止中にライザーを使い始めても、再開するまで音量は 0', () => {
    const { bgm, riser } = setup();
    bgm.start();
    bgm.pause();
    bgm.setRiser(0.6);
    const r = riser()!;
    expect(r.gain.gain.lastTarget).toBe(0);
    bgm.resume();
    expect(r.gain.gain.lastTarget).toBeCloseTo(0.6 * 0.6 * 0.35, 9);
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
    const { ctx, bgm, timer, run, nodes, riser } = setup();
    bgm.start();
    bgm.setRiser(0.2);
    run(0.5);
    const n = nodes();
    const r = riser()!;
    bgm.dispose();
    expect(r.src.stopCalls).toBe(1);
    expect(r.osc.stopCalls).toBe(1);
    for (const node of [n.filter, ...n.layers, r.gain, r.filter, r.src, r.osc, r.oscGain]) {
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
    const { bgm, nodes, riser } = setup();
    bgm.start();
    bgm.setTier(2);
    bgm.setRiser(0.4);
    bgm.setOpenness(0.5, 1);
    const n = nodes();
    const r = riser()!;
    const params = [n.filter.frequency, ...n.layers.map((g) => g.gain), r.gain.gain, r.filter.frequency, r.osc.frequency, r.oscGain.gain];
    const count = () => params.reduce((sum, p) => sum + p.events.length, 0);
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
    const { bgm, nodes } = setup();
    bgm.start();
    const f = nodes().filter.frequency;
    expect(f.lastTarget).toBe(18000);
    bgm.setRiser(0);
    expect(f.lastTarget).toBe(9000);
    bgm.restart();
    expect(f.lastTarget).toBe(18000);
    bgm.setRiser(0);
    expect(f.lastTarget).toBe(9000);
    // 使い始めは段階的に動かさず、今すぐ切り替える
    expect(f.events.at(-1)).toMatchObject({ kind: 'set' });
  });

  test('開き具合でこもらせた直後にライザーを 0 にしても、こもっていく変化は消えない', () => {
    const { ctx, bgm, run, nodes } = setup();
    bgm.start();
    run(1);
    const t = ctx.currentTime;
    bgm.setOpenness(0.08, 1.4);
    bgm.setRiser(0);
    const f = nodes().filter.frequency;
    expect(f.lastTarget).toBeCloseTo(opennessHz(0.08), 6);
    expect(f.valueAt(t + 1.4)).toBeCloseTo(opennessHz(0.08), 6);
    // 9 kHz へ跳ばない
    expect(f.valueAt(t + 0.01)).toBeLessThan(18000);
    expect(f.valueAt(t + 0.01)).toBeGreaterThan(9000);
  });

  test('こもっていく途中で高まりが変わっても、行き先も着く時刻も変えない', () => {
    const { ctx, bgm, run, nodes } = setup();
    bgm.start();
    bgm.setRiser(0.2);
    run(1);
    const t = ctx.currentTime;
    bgm.setOpenness(0.08, 1.4);
    const f = nodes().filter.frequency;
    const events = f.events.length;
    for (let i = 0; i < 20; i++) {
      run(1 / 60);
      bgm.setRiser(0.2 + i * 0.03);
    }
    expect(f.events.length).toBe(events);
    expect(f.valueAt(t + 1.4)).toBeCloseTo(opennessHz(0.08), 6);
  });

  test('ライザーの上限のほうが低いときは、開き具合を変えてもライザーの上限に従う', () => {
    const { bgm, nodes } = setup();
    bgm.start();
    bgm.setRiser(0.5);
    const f = nodes().filter.frequency;
    expect(f.lastTarget).toBeCloseTo(13500, 6);
    bgm.setOpenness(0.99, 1);
    expect(f.lastTarget).toBeCloseTo(13500, 6);
    bgm.setOpenness(0.5, 1);
    expect(f.lastTarget).toBeCloseTo(opennessHz(0.5), 6);
  });

  test('AudioContext が動き出す前に start() しても、動き出したらステップ 0 から鳴らす', () => {
    const ctx = new MockAudioContext();
    ctx.state = 'suspended';
    // 本物の resume() は、状態をすぐには変えない
    ctx.resume = () => Promise.resolve();
    const engine = new AudioEngine(() => ctx.asContext());
    const timer = new FakeTimer();
    const steps: number[] = [];
    const bgm = new LayeredBgm(engine, arrangement(steps), timer);
    engine.unlock();
    bgm.start();
    for (let i = 0; i < 4; i++) timer.fn?.();
    expect(steps).toEqual([]);
    ctx.state = 'running';
    for (let i = 0; i < 20; i++) {
      ctx.currentTime += 0.025;
      timer.fn?.();
    }
    expect(steps.slice(0, 3)).toEqual([0, 1, 2]);
  });

  test('AudioContext ができる前の設定も、ノードを作ったときに反映する', () => {
    const ctx = new MockAudioContext();
    const engine = new AudioEngine(() => ctx.asContext());
    const bgm = new LayeredBgm(engine, arrangement([]), new FakeTimer());
    bgm.setTier(4);
    bgm.setRiser(0);
    bgm.setOpenness(0.99, 1);
    engine.unlock();
    bgm.start();
    const n = mainNodes(ctx, engine);
    expect(n.layers[1].gain.lastTarget).toBe(0.8);
    expect(n.filter.frequency.lastTarget).toBe(9000);
    expect(latestRiser(ctx)).not.toBeNull();
  });
});
