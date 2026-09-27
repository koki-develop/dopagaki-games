import { describe, expect, test } from 'bun:test';
import type { HudState } from '../types.ts';
import { HudFeed } from './feed.ts';
import { formatScore } from './format.ts';
import { computeHudLayout, sameHudLayout } from './layout.ts';
import { HudModel } from './model.ts';
import { HudPresenter, HudWriter } from './writer.ts';
import type { HudTarget } from './writer.ts';

const state = (over: Partial<HudState> = {}): HudState => ({
  runId: 1,
  score: 0,
  chain: 0,
  multiplier: 1,
  best: 0,
  newBest: false,
  lives: 3,
  maxLives: 3,
  ...over,
});

/** 書き込みを記録する書き込み先 */
const fakeTarget = () => {
  const log: string[] = [];
  const t: HudTarget & { log: string[] } = {
    log,
    score: (v) => void log.push(`score ${v}`),
    bump: (v) => void log.push(`bump ${v}`),
    glow: (v) => void log.push(`glow ${v}`),
    best: (v) => void log.push(`best ${v}`),
    chain: (v) => void log.push(`chain ${v}`),
    lives: (on, max) => void log.push(`lives ${on}/${max}`),
    newBest: (v) => void log.push(`newBest ${v}`),
  };
  return t;
};

describe('HudModel', () => {
  test('スコアは実際の値へカウントアップして、最後は一致する', () => {
    const m = new HudModel(state());
    const shown: number[] = [];
    for (let i = 0; i < 120; i++) shown.push(Number(m.update(state({ score: 10_000 }), 1 / 60).score.replaceAll(',', '')));
    for (let i = 1; i < shown.length; i++) expect(shown[i]).toBeGreaterThanOrEqual(shown[i - 1] ?? 0);
    expect(shown[0]).toBeLessThan(10_000);
    expect(shown.at(-1)).toBe(10_000);
  });

  test('得点が入ると跳ね、時間とともに 0 へ戻る', () => {
    const m = new HudModel(state());
    const first = m.update(state({ score: 50 }), 1 / 60);
    expect(first.bump).toBeGreaterThan(0);
    let f = first;
    for (let i = 0; i < 10; i++) f = m.update(state({ score: 50 }), 1 / 60);
    expect(f.bump).toBeLessThan(first.bump);
    for (let i = 0; i < 120; i++) f = m.update(state({ score: 50 }), 1 / 60);
    expect(f.bump).toBe(0);
  });

  test('大きく入るほど強く跳ねる', () => {
    const small = new HudModel(state()).update(state({ score: 10 }), 1 / 60).bump;
    const big = new HudModel(state()).update(state({ score: 100_000 }), 1 / 60).bump;
    expect(big).toBeGreaterThan(small);
  });

  test('chain 倍率が上がるほど強く光る。chain は 2 以上で表示する', () => {
    const m = new HudModel(state());
    expect(m.update(state({ chain: 1, multiplier: 1.05 }), 1 / 60).chain).toBe('');
    const low = m.update(state({ chain: 2, multiplier: 1.1 }), 1 / 60);
    const high = m.update(state({ chain: 80, multiplier: 5 }), 1 / 60);
    expect(low.chain).toBe('2 CHAIN ×1.10');
    expect(high.glow).toBeGreaterThan(low.glow);
    expect(high.glow).toBe(1);
  });

  test('最初に届いた値から表示を始める', () => {
    const f = new HudModel(state({ score: 1234 })).update(state({ score: 1234 }), null);
    expect(f.score).toBe('1,234');
    expect(f.bump).toBe(0);
  });

  test('長い停止のあとでも、1 フレームで進める量には上限がある', () => {
    const m = new HudModel(state());
    const f = m.update(state({ score: 1000 }), 5);
    expect(f.score).toBe(formatScore(Math.round(1000 * Math.min(1, 0.1 * 14))));
  });
});

describe('HudWriter', () => {
  test('最初はすべて書き、以後は変わった値だけを書く', () => {
    const t = fakeTarget();
    const w = new HudWriter(t);
    const m = new HudModel(state());
    w.write(m.update(state(), null));
    expect(t.log).toEqual(['score 0', 'bump 0', 'glow 0', 'best 0', 'chain ', 'lives 3/3', 'newBest false']);
    t.log.length = 0;
    w.write(m.update(state(), 1 / 60));
    expect(t.log).toEqual([]);
    w.write(m.update(state({ lives: 2 }), 1 / 60));
    expect(t.log).toEqual(['lives 2/3']);
  });

  test('跳ねが収まった後は書き込みが止まる', () => {
    const t = fakeTarget();
    const w = new HudWriter(t);
    const m = new HudModel(state());
    w.write(m.update(state({ score: 10 }), 1 / 60));
    for (let i = 0; i < 200; i++) w.write(m.update(state({ score: 10 }), 1 / 60));
    t.log.length = 0;
    for (let i = 0; i < 10; i++) w.write(m.update(state({ score: 10 }), 1 / 60));
    expect(t.log).toEqual([]);
  });
});

describe('HudPresenter', () => {
  test('runId が変わったら、値が同じでもすべて書き直し、前のプレイの続きから数えない', () => {
    const t = fakeTarget();
    const p = new HudPresenter(t);
    p.push(state({ runId: 1, score: 0 }), 0);
    for (let i = 1; i <= 5; i++) p.push(state({ runId: 1, score: 5000, chain: 10, multiplier: 1.5 }), i / 60);
    t.log.length = 0;
    p.push(state({ runId: 2 }), 1);
    expect(t.log).toEqual(['score 0', 'bump 0', 'glow 0', 'best 0', 'chain ', 'lives 3/3', 'newBest false']);
  });

  test('同じ runId の間は、経過時間でカウントアップする', () => {
    const t = fakeTarget();
    const p = new HudPresenter(t);
    p.push(state({ score: 0 }), 10);
    t.log.length = 0;
    p.push(state({ score: 1000 }), 10 + 1 / 60);
    const score = t.log.find((l) => l.startsWith('score '));
    expect(score).toBeDefined();
    expect(score).not.toBe('score 1,000');
  });
});

describe('HudFeed', () => {
  test('つないだ時点で最後の値を渡し、外した後は渡さない', () => {
    const feed = new HudFeed();
    feed.push(state({ score: 7 }));
    const got: number[] = [];
    const off = feed.connect((s) => got.push(s.score));
    feed.push(state({ score: 8 }));
    off();
    feed.push(state({ score: 9 }));
    expect(got).toEqual([7, 8]);
  });
});

describe('computeHudLayout', () => {
  test('HUD の下端とスコアの中心を、描画領域の左上からの位置で返す', () => {
    const l = computeHudLayout(
      { left: 10, top: 20, width: 400, height: 800 },
      { left: 10, top: 20, width: 400, height: 90 },
      { left: 160, top: 40, width: 100, height: 40 },
      34,
    );
    expect(l).toEqual({ top: 90, bottom: 34, scoreAnchor: { x: 200, y: 40 } });
  });

  test('負の値にはならない。スコアがなければ位置は null', () => {
    const l = computeHudLayout({ left: 0, top: 100, width: 1, height: 1 }, { left: 0, top: 0, width: 1, height: 50 }, null, -3);
    expect(l).toEqual({ top: 0, bottom: 0, scoreAnchor: null });
  });

  test('同じ配置かどうか', () => {
    const a = { top: 1, bottom: 2, scoreAnchor: { x: 3, y: 4 } };
    expect(sameHudLayout(null, a)).toBe(false);
    expect(sameHudLayout(a, { ...a, scoreAnchor: { x: 3, y: 4 } })).toBe(true);
    expect(sameHudLayout(a, { ...a, scoreAnchor: null })).toBe(false);
    expect(sameHudLayout({ ...a, scoreAnchor: null }, { ...a, scoreAnchor: null })).toBe(true);
    expect(sameHudLayout(a, { ...a, top: 5 })).toBe(false);
  });
});
