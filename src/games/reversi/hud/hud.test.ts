import { describe, expect, test } from 'bun:test';
import { BLACK, WHITE } from '../rules/position.ts';
import type { HudState } from '../types.ts';
import { HudModel } from './model.ts';
import { HudPresenter } from './writer.ts';
import type { HudTarget } from './writer.ts';

const state = (over: Partial<HudState> = {}): HudState => ({
  runId: 1,
  human: BLACK,
  black: 2,
  white: 2,
  score: 0,
  newBest: false,
  comboWindow: 0,
  fever: 0,
  ...over,
});

const fakeTarget = () => {
  const log: string[] = [];
  const t: HudTarget & { log: string[] } = {
    log,
    counts: (h, c) => void log.push(`counts ${h}-${c}`),
    bumps: (h, c) => void log.push(`bumps ${h} ${c}`),
    share: (v) => void log.push(`share ${v}`),
    gauge: (window, fever) => void log.push(`gauge ${window} ${fever}`),
    score: (text, bump, best) => void log.push(`score ${text} ${bump} ${best}`),
  };
  return t;
};

describe('HudModel', () => {
  test('人の色に合わせて、人と CPU の数を出す', () => {
    expect(new HudModel(state()).update(state({ black: 10, white: 3 }), null)).toMatchObject({ human: '10', cpu: '3' });
    expect(new HudModel(state({ human: WHITE })).update(state({ human: WHITE, black: 10, white: 3 }), null)).toMatchObject({ human: '3', cpu: '10' });
  });

  test('毎フレーム同じ入れ物を返し、文字列は値が変わったときだけ作り直す', () => {
    const m = new HudModel(state());
    const f = m.update(state({ black: 5, score: 1234 }), 1 / 60);
    const human = f.human;
    const g = m.update(state({ black: 5, score: 1234 }), 1 / 60);
    expect(g).toBe(f);
    expect(g.human).toBe(human);
    expect(m.update(state({ black: 6, score: 1234 }), 1 / 60)).toMatchObject({ human: '6' });
  });

  test('数が増えた側だけが跳ね、時間とともに 0 へ戻る', () => {
    const m = new HudModel(state());
    const f = m.update(state({ black: 5 }), 1 / 60);
    expect(f.humanBump).toBeGreaterThan(0);
    expect(f.cpuBump).toBe(0);
    let g = f;
    for (let i = 0; i < 120; i++) g = m.update(state({ black: 5 }), 1 / 60);
    expect(g.humanBump).toBe(0);
  });

  test('バーは割合へ行き過ぎてから戻り、最後はぴったり止まる', () => {
    const m = new HudModel(state());
    const shares: number[] = [];
    for (let i = 0; i < 240; i++) shares.push(m.update(state({ black: 12, white: 4 }), 1 / 60).share);
    expect(Math.max(...shares)).toBeGreaterThan(0.75);
    expect(shares.at(-1)).toBe(0.75);
  });

  test('フレームの長さが違っても、バーは同じように動く', () => {
    const target = state({ black: 12, white: 4 });
    const a = new HudModel(state());
    const b = new HudModel(state());
    for (let i = 0; i < 3; i++) {
      const fa = a.update(target, 1 / 30);
      let fb = fa;
      for (let k = 0; k < 4; k++) fb = b.update(target, 1 / 120);
      expect(Math.abs(fa.share - fb.share)).toBeLessThan(0.002);
    }
  });
});

describe('HudModel の得点', () => {
  test('得点は実際の値へ転がるように増え、増えている間は跳ね、追いつくと止まる', () => {
    const m = new HudModel(state());
    const f = m.update(state({ score: 5000 }), 1 / 60);
    const first = Number(f.score.replace(/,/g, ''));
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(5000);
    expect(f.scoreBump).toBe(1);
    let g = f;
    for (let i = 0; i < 180; i++) g = m.update(state({ score: 5000 }), 1 / 60);
    expect([g.score, g.scoreBump]).toEqual(['5,000', 0]);
  });

});

describe('HudPresenter', () => {
  test('最初はすべて書き、以後は変わった値だけを書く。runId が変わったら書き直す', () => {
    const t = fakeTarget();
    const p = new HudPresenter(t);
    p.push(state(), 0);
    expect(t.log).toEqual(['counts 2-2', 'bumps 0 0', 'share 0.5', 'score 0 0 false', 'gauge 0 0']);
    t.log.length = 0;
    p.push(state(), 1 / 60);
    expect(t.log).toEqual([]);
    p.push(state({ comboWindow: 0.75, fever: 0.25 }), 2 / 60);
    expect(t.log).toEqual(['gauge 0.75 0.25']);
    t.log.length = 0;
    p.push(state({ runId: 2 }), 3 / 60);
    expect(t.log).toEqual(['counts 2-2', 'bumps 0 0', 'share 0.5', 'score 0 0 false', 'gauge 0 0']);
  });
});
