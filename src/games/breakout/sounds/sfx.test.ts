import { describe, expect, test } from 'bun:test';
import { AudioEngine } from '../../../juice/audio/engine.ts';
import { MockAudioContext } from '../../../juice/audio/mock-audio.test-support.ts';
import type { MockGain, MockSource } from '../../../juice/audio/mock-audio.test-support.ts';
import { BreakoutSfx } from './sfx.ts';

function setup() {
  const ctx = new MockAudioContext();
  const engine = new AudioEngine(() => ctx.asContext());
  engine.unlock();
  const group = engine.createGroup();
  const sfx = new BreakoutSfx(engine, group);
  return { ctx, engine, group, sfx };
}

/** 1 回鳴らすごとに作るノードの数（voice の出力の GainNode を含む） */
const NODES_PER_CALL: [string, (s: BreakoutSfx) => void, number][] = [
  ['paddle', (s) => s.paddle(1, 1), 8],
  ['hardHit', (s) => s.hardHit(0.5, 1), 10],
  ['solidHit', (s) => s.solidHit(1), 11],
  ['solidShatter', (s) => s.solidShatter(3, 1), 11],
  ['breakNote (count 1)', (s) => s.breakNote(3, 1, 0.5, 1), 6],
  ['breakNote (count 3)', (s) => s.breakNote(3, 3, 0.5, 1), 8],
  ['breakNote (count 3, brightness 1)', (s) => s.breakNote(3, 3, 1, 1), 6],
  ['bonusNote', (s) => s.bonusNote(3, 1), 5],
  ['megaBurst', (s) => s.megaBurst(2), 10],
  ['ballsZero', (s) => s.ballsZero(), 8],
  ['slam', (s) => s.slam(), 9],
  ['stepThud', (s) => s.stepThud(), 9],
  ['allClear', (s) => s.allClear(), 20],
  ['gameOver', (s) => s.gameOver(), 9],
  ['peakChord (level 0)', (s) => s.peakChord(0), 18],
  ['peakChord (level 3)', (s) => s.peakChord(3), 28],
  ['inhale', (s) => s.inhale(0.3), 6],
  ['finaleBurst', (s) => s.finaleBurst(), 33],
  ['resolveChord', (s) => s.resolveChord(), 23],
];

describe('BreakoutSfx', () => {
  test.each(NODES_PER_CALL)('%s が作るノードの数', (_name, play, nodes) => {
    const { ctx, sfx } = setup();
    ctx.resetCounts();
    play(sfx);
    expect(ctx.nodes).toBe(nodes);
  });

  test('Shepard tone の 1 音は、作り置きの波形を使う OscillatorNode 1 つで、揺らぎは detune', () => {
    const { ctx, sfx } = setup();
    for (let step = 0; step < 40; step++) {
      ctx.resetCounts();
      const before = ctx.sources.length;
      sfx.breakNote(step, 1, step % 2 === 0 ? 0.2 : 0.9, 1);
      expect(ctx.created.oscillator).toBe(1);
      const osc = ctx.sources[before];
      expect(osc.type).toBe('custom');
      expect(Math.abs(osc.detune.value)).toBeLessThanOrEqual(8);
      // 基本周波数は C3 から半音単位の目印（0〜12 半音）
      const semis = 12 * Math.log2(osc.frequency.value / 130.81);
      expect(Math.abs(semis - Math.round(semis))).toBeLessThan(1e-9);
      expect(semis).toBeGreaterThanOrEqual(-1e-9);
      expect(semis).toBeLessThanOrEqual(12 + 1e-9);
    }
    // 波形はペンタトニック 5 音（+ 下への回り込み）× sine / triangle の分だけ
    expect(ctx.periodicWaves.length).toBeLessThanOrEqual(12);
  });

  test('ボール大量ブロックの和音は 3 つの音でエンベロープを共有する', () => {
    const { ctx, sfx } = setup();
    const before = ctx.sources.length;
    sfx.megaBurst(4);
    const plucks = ctx.sources.slice(before).filter((s) => s.type === 'custom');
    expect(plucks.length).toBe(3);
    expect(new Set(plucks.map((p) => p.outputs[0])).size).toBe(1);
  });

  test('フィナーレの炸裂は、続けて鳴るボーナスの音に奪われない', () => {
    const { ctx, engine, sfx } = setup();
    const before = ctx.sources.length;
    sfx.finaleBurst();
    const burst = ctx.sources.slice(before);
    for (let f = 0; f < 200; f++) {
      ctx.currentTime = f / 60;
      engine.tick();
      if (ctx.currentTime >= 0.5 && ctx.currentTime <= 2.0) sfx.bonusNote(f % 40, 0.8);
    }
    // 自分で予約した stop() 以外に止められていない
    for (const s of burst) expect(s.stopCalls).toBe(1);
    expect(burst.some((s) => s.stopAt > 2.8)).toBe(true);
  });

  test('全消しの和音は、続けて鳴る破壊音に奪われない', () => {
    const { ctx, engine, sfx } = setup();
    const before = ctx.sources.length;
    sfx.allClear();
    const chord = ctx.sources.slice(before);
    for (let f = 0; f < 90; f++) {
      ctx.currentTime = f / 60;
      engine.tick();
      // 同時発音数の上限を超えるほど鳴らす
      for (let k = 0; k < 4; k++) sfx.breakNote((f + k) % 40, 3, 0.8, 1);
    }
    // 自分で予約した stop() 以外に止められていない
    for (const s of chord) expect(s.stopCalls).toBe(1);
    expect(chord.some((s) => s.stopAt > 1.0)).toBe(true);
  });

  test('鳴らした音はすべて group に属し、stopAll() でまとめて止まる', () => {
    const { ctx, engine, group, sfx } = setup();
    const other = new BreakoutSfx(engine, engine.createGroup());
    sfx.resolveChord();
    sfx.inhale(0.3);
    sfx.breakNote(1, 3, 0.5, 1);
    const mine = ctx.sources.slice();
    other.breakNote(1, 3, 0.5, 1);
    const theirs = ctx.sources.slice(mine.length);
    const active = () => engine.activeVoices('sfx') + engine.activeVoices('lead');
    expect(active()).toBe(4);
    ctx.currentTime = 0.1;
    group.stopAll(0.03);
    expect(active()).toBe(1);
    for (const s of mine) expect(s.stopAt).toBeLessThanOrEqual(0.13 + 1e-9);
    // ほかのまとまりの音は、自分で予約した stop() のまま
    for (const s of theirs) expect(s.stopCalls).toBe(1);
  });

  test('AudioContext が動いていなければ何も作らない', () => {
    const ctx = new MockAudioContext();
    const engine = new AudioEngine(() => ctx.asContext());
    const sfx = new BreakoutSfx(engine, engine.createGroup());
    for (const [, play] of NODES_PER_CALL) play(sfx);
    expect(ctx.nodes).toBe(0);
  });

  test('溜めの吸い込む音は、止めるとすぐに音量を下げ、音源を止める', () => {
    const { ctx, sfx } = setup();
    const sources = ctx.sources.length;
    const handle = sfx.inhale(0.3);
    const mine = ctx.sources.slice(sources);
    expect(mine.length).toBeGreaterThan(0);
    ctx.currentTime = 0.1;
    handle.stop();
    for (const src of mine) expect(src.stopAt).toBeLessThanOrEqual(0.1 + 0.05);
  });

  test('supersaw のノコギリ波は 1 つのエンベロープにまとめてからローパスへつなぐ', () => {
    const { ctx, sfx } = setup();
    const before = ctx.sources.length;
    sfx.resolveChord();
    const saws = ctx.sources.slice(before).filter((s) => s.type === 'sawtooth');
    expect(saws.length).toBe(18);
    const env = saws[0].outputs[0] as MockGain;
    expect(saws.every((s: MockSource) => s.outputs[0] === env)).toBe(true);
    // 共有するエンベロープのピークは、ノコギリ波 1 本あたりの値 0.34 / √(和音の数 × 2)
    expect(env.gain.events.find((e) => e.kind === 'linear')!.value).toBeCloseTo(0.34 / Math.sqrt(18), 9);
  });
});
