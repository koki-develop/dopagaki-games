import { describe, expect, test } from 'bun:test';
import { AudioEngine } from '../../../juice/audio/engine.ts';
import type { Voice } from '../../../juice/audio/engine.ts';
import { MockAudioContext } from '../../../juice/audio/mock-audio.test-support.ts';
import type { MockSource } from '../../../juice/audio/mock-audio.test-support.ts';
import { ReversiSfx } from './sfx.ts';

function setup() {
  const ctx = new MockAudioContext();
  const engine = new AudioEngine(() => ctx.asContext());
  engine.unlock();
  const sfx = new ReversiSfx(engine, engine.createGroup());
  return { ctx, sfx };
}

/** どの効果音も、ありうる引数の範囲を広めに取って鳴らす */
const CALLS: [string, (s: ReversiSfx, i: number) => void][] = [
  ['swoosh', (s, i) => s.swoosh(0.11, i % 5)],
  ['place human', (s, i) => s.place('human', i % 5)],
  ['place cpu', (s, i) => s.place('cpu', i % 5)],
  ['flipStep human', (s, i) => s.flipStep('human', i, 1 + (i % 4), i % 5)],
  ['flipStep cpu', (s, i) => s.flipStep('cpu', i, 1 + (i % 4), 0)],
  ['burst', (s, i) => s.burst(2 + (i % 3))],
  ['inhale', (s) => s.inhale(0.3)],
  ['gatherLift rising', (s) => s.gatherLift(0.35, true)],
  ['gatherLift flat', (s) => s.gatherLift(0.35, false)],
  ['dread', (s, i) => s.dread((i % 5) / 4)],
  ['corner', (s) => s.corner()],
  ['stable', (s, i) => s.stable(1 + (i % 10))],
  ['combo', (s, i) => s.combo(1 + i)],
  ['comboBreak', (s) => s.comboBreak()],
  ['score', (s, i) => s.score(1 + (i % 21) / 10, false)],
  ['score quick', (s, i) => s.score(1 + (i % 21) / 10, true)],
  ['newBest', (s) => s.newBest()],
  ['pass human', (s) => s.pass('human')],
  ['pass cpu', (s) => s.pass('cpu')],
  ['nope', (s) => s.nope()],
  ['introDrop', (s, i) => s.introDrop(i)],
  ['boardIn', (s) => s.boardIn()],
  ['vanish', (s) => s.vanish()],
  ['countTick human rising', (s, i) => s.countTick('human', i, i % 2 === 0, true)],
  ['countTick human flat', (s, i) => s.countTick('human', i, i % 2 === 0, false)],
  ['countTick cpu', (s, i) => s.countTick('cpu', i, i % 2 === 0, true)],
  ['verdict win', (s) => s.verdict('win', false)],
  ['verdict perfect', (s) => s.verdict('win', true)],
  ['verdict lose', (s) => s.verdict('lose', false)],
  ['verdict draw', (s) => s.verdict('draw', false)],
];

describe('ReversiSfx', () => {
  test.each(CALLS)('%s は、何度目でも可聴域の周波数で鳴る', (_name, play) => {
    const { ctx, sfx } = setup();
    for (let i = 0; i < 200; i++) {
      ctx.currentTime = i * 0.01;
      play(sfx, i);
    }
    expect(ctx.sources.length).toBeGreaterThan(0);
    for (const src of ctx.sources) {
      if (src.kind !== 'oscillator') continue;
      for (const e of src.frequency.events) {
        if (e.kind === 'cancel') continue;
        expect(e.value).toBeGreaterThan(0);
        expect(e.value).toBeLessThan(24000);
      }
    }
  });

  test.each(CALLS)('%s の音源は、どれも確保した voice の長さのうちに止まる', (_name, play) => {
    const ctx = new MockAudioContext();
    const engine = new AudioEngine(() => ctx.asContext());
    engine.unlock();
    const voices: Voice[] = [];
    const open = engine.voice.bind(engine);
    engine.voice = (req) => {
      const v = open(req);
      if (v) voices.push(v);
      return v;
    };
    const sfx = new ReversiSfx(engine, engine.createGroup());
    for (let i = 0; i < 12; i++) {
      ctx.currentTime = i * 5;
      play(sfx, i);
    }
    expect(voices.length).toBeGreaterThan(0);
    // 作った音源は、どれもどれかの voice が止める
    expect(voices.reduce((n, v) => n + v.sources.length, 0)).toBe(ctx.sources.length);
    for (const v of voices) {
      expect(v.sources.length).toBeGreaterThan(0);
      for (const src of v.sources as unknown as MockSource[]) {
        expect(src.startAt).toBeGreaterThanOrEqual(v.start);
        expect(src.stopAt).toBeLessThanOrEqual(v.end + 1e-9);
      }
    }
  });

  test('人の石が着く音は、段階が上がるほど層が増える', () => {
    const layers = (tier: number): number => {
      const { ctx, sfx } = setup();
      sfx.place('human', tier);
      return ctx.sources.length;
    };
    const counts = [0, 1, 2, 3, 4].map(layers);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    // 段階 1 で金属の打撃、段階 3 で爆発の尾が加わる
    expect(counts[1]).toBeGreaterThan(counts[0]);
    expect(counts[3]).toBeGreaterThan(counts[2]);
  });

  test('人の手の返る音は上がり、CPU の手の返る音は下がっていく（Shepard tone の基準の半音の位置で比べる）', () => {
    const detuneOf = (side: 'human' | 'cpu', index: number): number => {
      const { ctx, sfx } = setup();
      sfx.flipStep(side, index, 1, 0);
      const osc = ctx.sources.find((s) => s.kind === 'oscillator' && s.type === 'custom');
      if (!osc) throw new Error('no shepard oscillator');
      // 基本周波数（半音単位の目印）と detune から、オクターブの中の位置（半音）を求める
      const semis = 12 * Math.log2(osc.frequency.value / 130.81) + osc.detune.value / 100;
      return ((semis % 12) + 12) % 12;
    };
    // 揺らぎ（±8 セント）でオクターブの境目をまたぐことがあるので、差は -6〜6 半音に戻して比べる
    const diff = (a: number, b: number): number => ((((a - b) % 12) + 18) % 12) - 6;
    // ペンタトニックの 0 → 1 番目は 2 半音上がる。短調を下がる 0 → 1 番目は 2 半音下がる
    expect(diff(detuneOf('human', 1), detuneOf('human', 0))).toBeCloseTo(2, 0);
    expect(diff(detuneOf('cpu', 1), detuneOf('cpu', 0))).toBeCloseTo(-2, 0);
  });

  test('負けと引き分けの儀式の音（rising が false）と CPU の手の音は、音程もフィルタも上がらず、数えるたびに高くもならない', () => {
    /** 鳴らした音の周波数の予約のうち、最初の値より上がるもの */
    const risingEvents = (play: (s: ReversiSfx) => void): number => {
      const { ctx, sfx } = setup();
      const sources = ctx.sources.length;
      const filters = ctx.filters.length;
      play(sfx);
      const params = [...ctx.sources.slice(sources).filter((x) => x.kind === 'oscillator'), ...ctx.filters.slice(filters)].map((x) => x.frequency);
      let n = 0;
      for (const p of params) {
        const first = p.events.find((e) => e.kind === 'set');
        const start = first?.kind === 'set' ? first.value : p.value;
        for (const e of p.events) if ((e.kind === 'linear' || e.kind === 'exponential') && e.value > start) n++;
      }
      return n;
    };
    const firstPitch = (play: (s: ReversiSfx) => void): number => {
      const { ctx, sfx } = setup();
      const sources = ctx.sources.length;
      play(sfx);
      const osc = ctx.sources.slice(sources).find((x) => x.kind === 'oscillator');
      if (!osc) throw new Error('no oscillator');
      return osc.frequency.value;
    };
    for (let i = 0; i < 12; i++) {
      expect(risingEvents((s) => s.countTick('human', i, i % 2 === 0, false))).toBe(0);
      expect(risingEvents((s) => s.countTick('cpu', i, i % 2 === 0, false))).toBe(0);
      expect(firstPitch((s) => s.countTick('human', i, false, false))).toBe(firstPitch((s) => s.countTick('human', 0, false, false)));
    }
    expect(risingEvents((s) => s.gatherLift(0.35, false))).toBe(0);
    // 石が消える音は、勝ち負けによらず上がらない
    expect(risingEvents((s) => s.vanish())).toBe(0);
    // CPU の手の音と負けの和音も上がらない
    for (let i = 0; i < 5; i++) {
      expect(risingEvents((s) => s.place('cpu', i))).toBe(0);
      expect(risingEvents((s) => s.flipStep('cpu', i, 1 + i, 0))).toBe(0);
      expect(risingEvents((s) => s.dread(i / 4))).toBe(0);
    }
    expect(risingEvents((s) => s.verdict('lose', false))).toBe(0);
    expect(risingEvents((s) => s.comboBreak())).toBe(0);
    // 勝ちの音は上がる
    expect(risingEvents((s) => s.gatherLift(0.35, true))).toBeGreaterThan(0);
  });

  test('溜めの吸い込む音は、止めるとすぐに音量を下げ、音源を止める', () => {
    const { ctx, sfx } = setup();
    const sources = ctx.sources.length;
    const handle = sfx.inhale(0.45);
    const mine = ctx.sources.slice(sources);
    expect(mine.length).toBeGreaterThan(0);
    ctx.currentTime = 0.1;
    handle.stop();
    for (const src of mine) expect(src.stopAt).toBeLessThanOrEqual(0.1 + 0.05);
  });
});
