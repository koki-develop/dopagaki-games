import { describe, expect, test } from 'bun:test';
import { AudioEngine } from '../../../juice/audio/engine.ts';
import type { Voice } from '../../../juice/audio/engine.ts';
import { MockAudioContext } from '../../../juice/audio/mock-audio.test-support.ts';
import type { MockSource } from '../../../juice/audio/mock-audio.test-support.ts';
import { BlackjackSfx } from './sfx.ts';

function setup() {
  const ctx = new MockAudioContext();
  const engine = new AudioEngine(() => ctx.asContext());
  engine.unlock();
  const sfx = new BlackjackSfx(engine, engine.createGroup());
  return { ctx, engine, sfx };
}

/** どの効果音も、ありうる引数の範囲を広めに取って鳴らす */
const CALLS: [string, (s: BlackjackSfx, i: number) => void][] = [
  ['deal', (s, i) => s.deal(0.2 + (i % 3) * 0.03)],
  ['land', (s, i) => s.land(i % 2 === 0)],
  ['flip', (s, i) => s.flip(i % 2 === 0)],
  ['drumRoll', (s, i) => s.drumRoll(0.1 + (i % 6) * 0.1)],
  ['peek', (s) => s.peek()],
  ['chip', (s, i) => s.chip(i)],
  ['coin', (s, i) => s.coin(i, (i % 5) / 4)],
  ['stand', (s) => s.stand()],
  ['split', (s) => s.split()],
  ['double', (s) => s.double()],
  ['bust', (s) => s.bust()],
  ['twentyOne', (s) => s.twentyOne()],
  ['blackjack', (s) => s.blackjack()],
  ['dealerBust rising', (s) => s.dealerBust(true)],
  ['dealerBust flat', (s) => s.dealerBust(false)],
  ['dealerBlackjack', (s) => s.dealerBlackjack()],
  ['win', (s, i) => s.win(i % 5)],
  ['lose', (s, i) => s.lose(i)],
  ['push', (s) => s.push()],
  ['streak', (s, i) => s.streak(2 + i)],
  ['streakBreak', (s) => s.streakBreak()],
  ['finalRound', (s) => s.finalRound()],
  ['reshuffle', (s) => s.reshuffle()],
  ['nope', (s) => s.nope()],
  ['sweep', (s) => s.sweep()],
  ['tableIn', (s) => s.tableIn()],
  ['newBest', (s) => s.newBest()],
  ['verdict profit', (s) => s.verdict('profit')],
  ['verdict even', (s) => s.verdict('even')],
  ['verdict loss', (s) => s.verdict('loss')],
  ['verdict broke', (s) => s.verdict('broke')],
];

describe('BlackjackSfx', () => {
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
    const sfx = new BlackjackSfx(engine, engine.createGroup());
    for (let i = 0; i < 12; i++) {
      ctx.currentTime = i * 5;
      play(sfx, i);
    }
    expect(voices.length).toBeGreaterThan(0);
    expect(voices.reduce((n, v) => n + v.sources.length, 0)).toBe(ctx.sources.length);
    for (const v of voices) {
      expect(v.sources.length).toBeGreaterThan(0);
      for (const src of v.sources as unknown as MockSource[]) {
        expect(src.startAt).toBeGreaterThanOrEqual(v.start);
        expect(src.stopAt).toBeLessThanOrEqual(v.end + 1e-9);
      }
    }
  });

  test('聞き逃せない節目の音は event の優先度で鳴らす', () => {
    for (const [name, play] of CALLS.filter(([n]) => ['bust', 'blackjack', 'dealerBlackjack', 'streak', 'finalRound', 'newBest', 'verdict profit', 'verdict loss'].includes(n))) {
      const { engine, sfx } = setup();
      const priorities: string[] = [];
      const open = engine.voice.bind(engine);
      engine.voice = (req) => {
        priorities.push(req.priority ?? 'normal');
        return open(req);
      };
      play(sfx, 3);
      expect([name, priorities.every((p) => p === 'event')]).toEqual([name, true]);
    }
  });

  test('溜めのドラムロールは、ほかの音を消した中で鳴らす lead の経路で鳴らし、止められる', () => {
    const { engine, sfx } = setup();
    const buses: string[] = [];
    const open = engine.voice.bind(engine);
    engine.voice = (req) => {
      buses.push(req.bus);
      return open(req);
    };
    const handle = sfx.drumRoll(0.4);
    expect(buses).toEqual(['lead']);
    expect(() => handle.stop()).not.toThrow();
  });
});
