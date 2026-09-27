import { describe, expect, test } from 'bun:test';
import { AudioEngine } from './engine.ts';
import type { Bus, Voice, VoiceRequest } from './engine.ts';
import { MockAudioContext } from './mock-audio.test-support.ts';
import type { MockGain, MockSource } from './mock-audio.test-support.ts';

function setup() {
  const ctx = new MockAudioContext();
  const engine = new AudioEngine(() => ctx.asContext());
  engine.unlock();
  return { ctx, engine };
}

/** 音源を 1 つ持つ voice を作る */
function play(engine: AudioEngine, ctx: MockAudioContext, req: VoiceRequest): Voice | null {
  const v = engine.voice(req);
  if (!v) return null;
  const src = ctx.createOscillator();
  src.start(v.start);
  src.stop(v.end);
  v.track(src as unknown as AudioScheduledSourceNode);
  return v;
}

const out = (v: Voice) => v.out as unknown as MockGain;
const sources = (v: Voice) => v.sources as unknown as MockSource[];

describe('AudioEngine', () => {
  test('AudioContext は unlock() で 1 度だけ作り、それまでは鳴らさない', () => {
    const ctx = new MockAudioContext();
    let made = 0;
    const engine = new AudioEngine(() => {
      made++;
      return ctx.asContext();
    });
    expect(engine.voice({ bus: 'sfx', duration: 1, gain: 1 })).toBeNull();
    engine.unlock();
    engine.unlock();
    expect(made).toBe(1);
    expect(engine.voice({ bus: 'sfx', duration: 1, gain: 1 })).not.toBeNull();
    ctx.state = 'suspended';
    expect(engine.voice({ bus: 'sfx', duration: 1, gain: 1 })).toBeNull();
  });

  test('preload() は AudioContext を作るだけで再開せず、unlock() で作り直さずに再開する', () => {
    const ctx = new MockAudioContext();
    ctx.state = 'suspended';
    let made = 0;
    const engine = new AudioEngine(() => {
      made++;
      return ctx.asContext();
    });
    engine.preload();
    engine.preload();
    expect(made).toBe(1);
    expect(engine.ctx).toBe(ctx.asContext());
    expect(ctx.resumeCalls).toBe(0);
    expect(engine.running).toBe(false);
    expect(engine.voice({ bus: 'sfx', duration: 1, gain: 1 })).toBeNull();
    // バスと音量は作った時点でできている
    expect(ctx.gains.length).toBeGreaterThan(0);
    engine.unlock();
    expect(made).toBe(1);
    expect(ctx.resumeCalls).toBe(1);
    expect(engine.running).toBe(true);
    expect(engine.voice({ bus: 'sfx', duration: 1, gain: 1 })).not.toBeNull();
  });

  test('voice は AudioContext とノイズを graph と共有する', () => {
    const { engine } = setup();
    const v = engine.voice({ bus: 'sfx', duration: 1, gain: 1 })!;
    const g = engine.graph!;
    expect(v.ctx).toBe(g.ctx);
    expect(v.noise).toBe(g.noise);
    expect(g.noise.duration).toBeCloseTo(1.5, 9);
  });

  test('作れない環境では preload() も unlock() も何もしない', () => {
    const engine = new AudioEngine(() => null);
    engine.preload();
    engine.unlock();
    expect(engine.ctx).toBeNull();
    expect(engine.graph).toBeNull();
    expect(engine.running).toBe(false);
    expect(() => engine.silence(1).cancel()).not.toThrow();
    expect(() => engine.tick()).not.toThrow();
  });

  test.each([
    ['sfx', 24],
    ['bgm', 20],
    ['lead', 4],
  ] as [Bus, number][])('%s の同時発音数は %d まで', (bus, max) => {
    const { ctx, engine } = setup();
    for (let i = 0; i < max + 10; i++) play(engine, ctx, { bus, duration: 5, gain: 1 });
    expect(engine.activeVoices(bus)).toBe(max);
  });

  test('枠が埋まったら一番古い音をフェードアウトさせて止める', () => {
    const { ctx, engine } = setup();
    const first = play(engine, ctx, { bus: 'sfx', duration: 5, gain: 0.8 })!;
    for (let i = 1; i < 24; i++) play(engine, ctx, { bus: 'sfx', duration: 5, gain: 1 });
    ctx.currentTime = 0.5;
    play(engine, ctx, { bus: 'sfx', duration: 5, gain: 1 });
    const g = out(first).gain;
    expect(g.events.at(-1)).toEqual({ kind: 'linear', value: 0, time: 0.5 + 0.015 });
    expect(sources(first)[0].stopAt).toBeCloseTo(0.515, 9);
    expect(engine.activeVoices('sfx')).toBe(24);
  });

  test('normal の音は、normal が残っている間は event の音を奪わない', () => {
    const { ctx, engine } = setup();
    const ev = play(engine, ctx, { bus: 'sfx', duration: 5, gain: 1, priority: 'event' })!;
    for (let i = 0; i < 200; i++) {
      ctx.currentTime = i / 60;
      play(engine, ctx, { bus: 'sfx', duration: 0.35, gain: 1 });
    }
    expect(sources(ev)[0].stopAt).toBe(5);
    expect(out(ev).gain.events.length).toBe(0);
  });

  test('event で埋まっていれば normal は鳴らさず、event は一番古い event を奪う', () => {
    const { ctx, engine } = setup();
    const events: Voice[] = [];
    for (let i = 0; i < 24; i++) events.push(play(engine, ctx, { bus: 'sfx', duration: 5, gain: 1, priority: 'event' })!);
    expect(play(engine, ctx, { bus: 'sfx', duration: 1, gain: 1 })).toBeNull();
    expect(events.every((v) => sources(v)[0].stopAt === 5)).toBe(true);
    expect(play(engine, ctx, { bus: 'sfx', duration: 1, gain: 1, priority: 'event' })).not.toBeNull();
    expect(sources(events[0])[0].stopAt).toBeCloseTo(0.015, 9);
    expect(sources(events[1])[0].stopAt).toBe(5);
  });

  test('event と normal が混ざっていれば、normal のうち一番古いものを奪う', () => {
    const { ctx, engine } = setup();
    const all: Voice[] = [];
    for (let i = 0; i < 24; i++) all.push(play(engine, ctx, { bus: 'sfx', duration: 5, gain: 1, priority: i < 3 ? 'event' : 'normal' })!);
    play(engine, ctx, { bus: 'sfx', duration: 5, gain: 1, priority: 'event' });
    expect(sources(all[3])[0].stopAt).toBeCloseTo(0.015, 9);
    for (const i of [0, 1, 2, 4]) expect(sources(all[i])[0].stopAt).toBe(5);
  });

  test('鳴り終わった音は tick() と次の voice() で片付け、activeVoices が正確になる', () => {
    const { ctx, engine } = setup();
    const vs: Voice[] = [];
    for (let i = 0; i < 5; i++) vs.push(play(engine, ctx, { bus: 'sfx', duration: 0.2, gain: 1 })!);
    play(engine, ctx, { bus: 'bgm', duration: 0.2, gain: 1 });
    expect(engine.activeVoices('sfx')).toBe(5);
    ctx.currentTime = 1;
    engine.tick();
    expect(engine.activeVoices('sfx')).toBe(0);
    expect(engine.activeVoices('bgm')).toBe(0);
    expect(vs.every((v) => out(v).disconnected)).toBe(true);

    play(engine, ctx, { bus: 'sfx', duration: 0.2, gain: 1 });
    ctx.currentTime = 2;
    play(engine, ctx, { bus: 'sfx', duration: 0.2, gain: 1 });
    expect(engine.activeVoices('sfx')).toBe(1);
  });

  test('奪われた音もフェードが終わったら切り離す', () => {
    const { ctx, engine } = setup();
    const first = play(engine, ctx, { bus: 'lead', duration: 5, gain: 1 })!;
    for (let i = 0; i < 4; i++) play(engine, ctx, { bus: 'lead', duration: 5, gain: 1 });
    expect(out(first).disconnected).toBe(false);
    ctx.currentTime = 0.1;
    engine.tick();
    expect(out(first).disconnected).toBe(true);
  });

  test('group.stopAll() はそのまとまりの音だけを、予約中のものも含めてフェードアウトさせて止める', () => {
    const { ctx, engine } = setup();
    const a = engine.createGroup();
    const b = engine.createGroup();
    const inA = [
      play(engine, ctx, { bus: 'sfx', duration: 3, gain: 1, group: a })!,
      play(engine, ctx, { bus: 'lead', duration: 3, gain: 1, group: a })!,
      play(engine, ctx, { bus: 'sfx', duration: 0.2, gain: 1, when: 2, group: a })!,
    ];
    const inB = play(engine, ctx, { bus: 'sfx', duration: 3, gain: 1, group: b })!;
    const loose = play(engine, ctx, { bus: 'sfx', duration: 3, gain: 1 })!;
    expect(a.size).toBe(3);
    ctx.currentTime = 1;
    a.stopAll(0.05);
    expect(a.size).toBe(0);
    expect(b.size).toBe(1);
    for (const v of inA) {
      expect(sources(v)[0].stopAt).toBeCloseTo(1.05, 9);
      expect(out(v).gain.events.at(-1)).toEqual({ kind: 'linear', value: 0, time: 1.05 });
    }
    // 予約中の音は鳴り始める前に止まる
    expect(sources(inA[2])[0].stopAt).toBeLessThan(inA[2].start);
    expect(sources(inB)[0].stopAt).toBe(3);
    expect(sources(loose)[0].stopAt).toBe(3);
    expect(engine.activeVoices('sfx')).toBe(2);
    expect(engine.activeVoices('lead')).toBe(0);
    ctx.currentTime = 1.2;
    engine.tick();
    expect(inA.every((v) => out(v).disconnected)).toBe(true);
  });

  test('silence() の cancel() は今すぐ元の音量へ戻す', () => {
    const { ctx, engine } = setup();
    // duck は sfx バスの接続先
    const v = engine.voice({ bus: 'sfx', duration: 1, gain: 1 })!;
    const sfxBus = out(v).outputs[0] as MockGain;
    const duck = sfxBus.outputs[0] as MockGain;
    ctx.currentTime = 2;
    const h = engine.silence(0.3, 0.005);
    expect(duck.gain.events.slice(-3)).toEqual([
      { kind: 'linear', value: 0, time: 2.012 },
      { kind: 'set', value: 0, time: 2.3 },
      { kind: 'linear', value: 1, time: 2 + 0.3 + 0.005 },
    ]);
    ctx.currentTime = 2.1;
    h.cancel();
    expect(duck.gain.events.slice(-2)).toEqual([
      { kind: 'cancel', time: 2.1 },
      { kind: 'set', value: 1, time: 2.1 },
    ]);
  });

  test('後から始まった silence() は、前の handle の cancel() では取り消されない', () => {
    const { ctx, engine } = setup();
    const v = engine.voice({ bus: 'sfx', duration: 1, gain: 1 })!;
    const duck = (out(v).outputs[0] as MockGain).outputs[0] as MockGain;
    const first = engine.silence(0.3);
    ctx.currentTime = 0.1;
    engine.silence(0.3);
    const count = duck.gain.events.length;
    first.cancel();
    expect(duck.gain.events.length).toBe(count);
  });

  test('voice の開始は when と今の遅い方', () => {
    const { ctx, engine } = setup();
    ctx.currentTime = 3;
    expect(engine.voice({ bus: 'sfx', duration: 1, gain: 1, when: 2 })!.start).toBe(3);
    expect(engine.voice({ bus: 'sfx', duration: 1, gain: 1, when: 4 })!.start).toBe(4);
  });
});
