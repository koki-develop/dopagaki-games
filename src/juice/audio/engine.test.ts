import { describe, expect, test } from 'bun:test';
import { AudioEngine, NO_SOUND, SOUND_STOP_FADE, voiceHandle } from './engine.ts';
import type { Bus, Voice, VoiceRequest } from './engine.ts';
import { MockAudioContext } from './mock-audio.test-support.ts';
import { send } from './synth.ts';
import type { MockGain, MockParam, MockSource } from './mock-audio.test-support.ts';

/** 手で進める setTimeout の代役 */
class FakeDelay {
  private pending: { fn: () => void; at: number; id: number }[] = [];
  private nowMs = 0;
  private nextId = 1;
  set = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.pending.push({ fn, at: this.nowMs + ms, id });
    return id;
  };
  clear = (id: unknown): void => {
    this.pending = this.pending.filter((p) => p.id !== id);
  };
  /** ms ミリ秒進め、時刻の来たものを呼ぶ */
  advance(ms: number): void {
    this.nowMs += ms;
    const due = this.pending.filter((p) => p.at <= this.nowMs);
    this.pending = this.pending.filter((p) => p.at > this.nowMs);
    for (const p of due) p.fn();
  }
}

function setup() {
  const ctx = new MockAudioContext();
  const delay = new FakeDelay();
  const engine = new AudioEngine(() => ctx.asContext(), delay);
  engine.unlock();
  return { ctx, engine, delay };
}

/** master の GainNode（コンプレッサーの手前） */
const masterGain = (engine: AudioEngine) => {
  const duck = duckNode(engine);
  return (duck.outputs[0] as MockGain).gain;
};
/** silence() で下げる GainNode */
const duckNode = (engine: AudioEngine) => {
  const sfx = (engine.graph as unknown as { buses: Record<Bus, MockGain> }).buses.sfx;
  return sfx.outputs[0] as MockGain;
};

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
/** 予約された行き先。予約が無ければ今の値 */
const level = (p: MockParam) => p.lastTarget ?? p.value;
/** silence() で下げる GainNode（効果音のバスの接続先）の音量 */
const duckGain = (engine: AudioEngine) => {
  const v = engine.voice({ bus: 'sfx', duration: 1, gain: 1 });
  if (!v) throw new Error('voice を確保できない');
  return ((out(v).outputs[0] as MockGain).outputs[0] as MockGain).gain;
};
/**
 * from から to まで step 秒ごとに見て、隣り合う値の差の最大。
 * 予定を組み直すと、組み直した時刻より前の予定は消えるので、from は最後に組み直した時刻より後にする
 */
const maxJump = (p: MockParam, from: number, to: number, step = 0.0005) => {
  let jump = 0;
  for (let t = from + step; t <= to; t += step) jump = Math.max(jump, Math.abs(p.valueAt(t) - p.valueAt(t - step)));
  return jump;
};
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

  test('共通の残響への送りも、鳴り終わったら残響から切り離す', () => {
    const { ctx, engine } = setup();
    const reverb = engine.graph!.reverb;
    const v = play(engine, ctx, { bus: 'sfx', duration: 0.2, gain: 1 })!;
    send(v, 0.3);
    const tap = ctx.gains.find((g) => g.outputs.includes(reverb as unknown as MockGain))!;
    expect(out(v).outputs).toContain(tap);
    ctx.currentTime = 1;
    engine.tick();
    expect(tap.disconnected).toBe(true);
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
    ctx.currentTime = 1;
    a.stopAll(0.05);
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

  test('効果音の共通の残響は、効果音のバスへ出る。歪みの曲線は端が ±1', () => {
    const { engine } = setup();
    const g = engine.graph!;
    const buses = (g as unknown as { buses: Record<Bus, MockGain> }).buses;
    const reverb = g.reverb as unknown as MockGain;
    expect(reverb.outputs[0].outputs[0]).toBe(buses.sfx);
    expect(g.drive[0]).toBeCloseTo(-1, 9);
    expect(g.drive[g.drive.length - 1]).toBeCloseTo(1, 9);
  });

  test('setEnabled() で効果音（lead を含む）と BGM のバスを消し、戻すと元の音量にする', () => {
    const { engine } = setup();
    const buses = (engine.graph as unknown as { buses: Record<Bus, MockGain> }).buses;
    const on = level(buses.sfx.gain);
    expect(on).toBeGreaterThan(0);
    engine.setEnabled({ sfx: false, bgm: true });
    expect([level(buses.sfx.gain), level(buses.lead.gain)]).toEqual([0, 0]);
    expect(level(buses.bgm.gain)).toBeGreaterThan(0);
    engine.setEnabled({ sfx: true, bgm: false });
    expect([level(buses.sfx.gain), level(buses.lead.gain), level(buses.bgm.gain)]).toEqual([on, on, 0]);
  });

  test('AudioContext を作る前に受け取った切り替えも、作ったときの音量にする。作った直後に音量を動かさない', () => {
    const ctx = new MockAudioContext();
    const engine = new AudioEngine(() => ctx.asContext());
    engine.setEnabled({ sfx: true, bgm: false });
    engine.unlock();
    const buses = (engine.graph as unknown as { buses: Record<Bus, MockGain> }).buses;
    expect(buses.bgm.gain.value).toBe(0);
    expect(buses.sfx.gain.value).toBeGreaterThan(0);
    for (const bus of Object.values(buses)) expect(bus.gain.events).toEqual([]);
  });

  test('silence() は、どの長さでも予定を時刻の順に並べ、最後に元の音量へ戻す。delay の後から下げる', () => {
    for (const [duration, delay] of [
      [0.3, 0],
      [0.004, 0],
      [0, 0],
      [0.004, 0.04],
      [0.5, 0.1],
    ]) {
      const { ctx, engine } = setup();
      const v = engine.voice({ bus: 'sfx', duration: 1, gain: 1 })!;
      const duck = (out(v).outputs[0] as MockGain).outputs[0] as MockGain;
      ctx.currentTime = 2;
      engine.silence(duration, 0.005, delay);
      const timed = duck.gain.events.filter((e) => e.kind !== 'cancel') as { kind: string; value: number; time: number }[];
      for (let i = 1; i < timed.length; i++) expect(timed[i].time).toBeGreaterThanOrEqual(timed[i - 1].time);
      expect(timed.at(-1)?.value).toBe(1);
      // delay の間は下げ始めない
      const firstZero = timed.find((e) => e.value === 0);
      expect(firstZero?.time).toBeGreaterThan(2 + delay);
    }
  });

  test('silence() は DUCK_FADE で下げ、区間の終わりまで保ち、fadeIn で戻す', () => {
    const { ctx, engine } = setup();
    const duck = duckGain(engine);
    ctx.currentTime = 2;
    engine.silence(0.3, 0.005);
    expect(duck.valueAt(2)).toBe(1);
    expect(duck.valueAt(2.012)).toBe(0);
    expect(duck.valueAt(2.3)).toBe(0);
    expect(duck.valueAt(2.305)).toBe(1);
  });

  test('cancel() は、ほかの無音が無ければ DUCK_FADE で元の音量へ戻す（跳ばない）', () => {
    const { ctx, engine } = setup();
    const duck = duckGain(engine);
    ctx.currentTime = 2;
    const h = engine.silence(0.3, 0.005);
    ctx.currentTime = 2.1;
    h.cancel();
    expect(duck.valueAt(2.1)).toBe(0);
    expect(duck.valueAt(2.112)).toBe(1);
    expect(maxJump(duck, 2.1, 2.4)).toBeLessThan(0.06);
    // 2 回目は何もしない
    const events = duck.events.length;
    h.cancel();
    expect(duck.events.length).toBe(events);
  });

  test('下げている途中の cancel() は、その時点の音量から戻す', () => {
    const { ctx, engine } = setup();
    const duck = duckGain(engine);
    ctx.currentTime = 1;
    const h = engine.silence(0.5);
    ctx.currentTime = 1.006;
    expect(duck.valueAt(1.006)).toBeCloseTo(0.5, 6);
    h.cancel();
    expect(duck.valueAt(1.006)).toBeCloseTo(0.5, 6);
    expect(duck.valueAt(1.006 + 0.012)).toBe(1);
    expect(maxJump(duck, 1.006, 1.1)).toBeLessThan(0.06);
  });

  test('後から短い silence() を呼んでも、前の無音は縮まない', () => {
    const { ctx, engine } = setup();
    const duck = duckGain(engine);
    engine.silence(0.5);
    ctx.currentTime = 0.1;
    engine.silence(0.1);
    expect(duck.valueAt(0.3)).toBe(0);
    expect(duck.valueAt(0.49)).toBe(0);
    expect(duck.valueAt(0.6)).toBe(1);
  });

  test('先の時刻に予約した無音は、後の silence() で消えない', () => {
    const { ctx, engine } = setup();
    const duck = duckGain(engine);
    engine.silence(0.2, 0.01, 1);
    ctx.currentTime = 0.1;
    engine.silence(0.1, 0.01);
    // 今の無音が終わって戻り、予約した無音でもう一度下がる
    expect(duck.valueAt(0.15)).toBe(0);
    expect(duck.valueAt(0.5)).toBe(1);
    expect(duck.valueAt(1.1)).toBe(0);
    expect(duck.valueAt(1.25)).toBe(1);
    expect(maxJump(duck, 0.1, 1.5)).toBeLessThan(0.06);
  });

  test('重なった無音の 1 つを cancel() しても、ほかの無音が続く間は無音のまま', () => {
    const { ctx, engine } = setup();
    const duck = duckGain(engine);
    const long = engine.silence(1);
    ctx.currentTime = 0.1;
    const short = engine.silence(0.2);
    ctx.currentTime = 0.15;
    short.cancel();
    expect(duck.valueAt(0.5)).toBe(0);
    ctx.currentTime = 0.6;
    long.cancel();
    expect(duck.valueAt(0.6 + 0.012)).toBe(1);
    expect(maxJump(duck, 0.6, 1.2)).toBeLessThan(0.06);
  });

  test('戻りきる前に次の silence() が始まったら、戻らずに無音を続ける', () => {
    const { ctx, engine } = setup();
    const duck = duckGain(engine);
    engine.silence(0.2, 0.1);
    ctx.currentTime = 0.1;
    engine.silence(0.2, 0.01, 0.15);
    expect(duck.valueAt(0.22)).toBe(0);
    expect(duck.valueAt(0.45)).toBe(0);
    expect(duck.valueAt(0.47)).toBe(1);
  });

  test('voice の開始は when と今の遅い方', () => {
    const { ctx, engine } = setup();
    ctx.currentTime = 3;
    expect(engine.voice({ bus: 'sfx', duration: 1, gain: 1, when: 2 })!.start).toBe(3);
    expect(engine.voice({ bus: 'sfx', duration: 1, gain: 1, when: 4 })!.start).toBe(4);
  });
});

describe('AudioEngine の一時停止', () => {
  test('setPaused(true) は全体の音量を素早く下げてから AudioContext を止め、setPaused(false) で動かして元の音量へ戻す', () => {
    const { ctx, engine, delay } = setup();
    ctx.currentTime = 2;
    const master = masterGain(engine);
    const full = master.value;
    engine.setPaused(true);
    expect(master.valueAt(2)).toBeCloseTo(full, 9);
    expect(master.valueAt(2.03)).toBe(0);
    // 下げきるまでは止めない
    expect(ctx.state).toBe('running');
    ctx.currentTime = 2.1;
    delay.advance(100);
    expect(ctx.state).toBe('suspended');
    expect(engine.running).toBe(false);
    expect(engine.voice({ bus: 'sfx', duration: 1, gain: 1 })).toBeNull();

    // AudioContext の時刻は止まっている間は進まない
    engine.setPaused(false);
    expect(ctx.state).toBe('running');
    expect(master.valueAt(2.1)).toBe(0);
    expect(master.valueAt(3)).toBeCloseTo(full, 9);
    expect(maxJump(master, 2.1, 3)).toBeLessThan(full / 4);
  });

  test('止めている間は、鳴っている音も無音の予定もその位置で止まり、解くとその位置から続く', () => {
    const { ctx, engine, delay } = setup();
    const v = play(engine, ctx, { bus: 'sfx', duration: 1, gain: 1 })!;
    engine.silence(0.5, 0.1, 0.2);
    const duckEvents = duckNode(engine).gain.events.length;
    engine.setPaused(true);
    delay.advance(100);
    engine.setPaused(false);
    // 予約した音と無音の予定には触れない
    expect(sources(v)[0].stopAt).toBe(1);
    expect(duckNode(engine).gain.events.length).toBe(duckEvents);
  });

  test('下げている途中で解いたら、止めずにその音量から戻す', () => {
    const { ctx, engine, delay } = setup();
    const master = masterGain(engine);
    const full = master.value;
    engine.setPaused(true);
    ctx.currentTime = 0.01;
    engine.setPaused(false);
    delay.advance(100);
    expect(ctx.state).toBe('running');
    expect(master.lastTarget).toBeCloseTo(full, 9);
    expect(maxJump(master, 0.01, 0.2)).toBeLessThan(full / 4);
  });

  test('止めている間は unlock() でも動かさない', () => {
    const { ctx, engine, delay } = setup();
    engine.setPaused(true);
    delay.advance(100);
    const calls = ctx.resumeCalls;
    engine.unlock();
    expect(ctx.resumeCalls).toBe(calls);
    expect(ctx.state).toBe('suspended');
    engine.setPaused(false);
    expect(ctx.state).toBe('running');
  });

  test('AudioContext を作る前に止めていれば、作ったときに無音で止めておく', () => {
    const ctx = new MockAudioContext();
    const delay = new FakeDelay();
    const engine = new AudioEngine(() => ctx.asContext(), delay);
    engine.setPaused(true);
    engine.unlock();
    expect(masterGain(engine).value).toBe(0);
    expect(engine.running).toBe(false);
    engine.setPaused(false);
    expect(engine.running).toBe(true);
    expect(masterGain(engine).lastTarget).toBeGreaterThan(0);
  });
});

describe('SoundHandle', () => {
  test('voiceHandle() の stop は、音を SOUND_STOP_FADE 秒で下げきって止める。NO_SOUND の stop は何もしない', () => {
    const { ctx, engine } = setup();
    const v = play(engine, ctx, { bus: 'sfx', duration: 3, gain: 1 })!;
    ctx.currentTime = 1;
    voiceHandle(v).stop();
    expect(SOUND_STOP_FADE).toBe(0.03);
    expect(out(v).gain.events.at(-1)).toEqual({ kind: 'linear', value: 0, time: 1 + SOUND_STOP_FADE });
    expect(sources(v)[0].stopAt).toBeCloseTo(1 + SOUND_STOP_FADE, 9);
    expect(() => NO_SOUND.stop()).not.toThrow();
  });
});
