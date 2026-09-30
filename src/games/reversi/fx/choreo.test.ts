import { describe, expect, test } from 'bun:test';
import { CHOREO, flipTier, HIT_STOP, hitStopFor } from '../config.ts';
import { initialPosition, parseSquare, play, positionFromRows, squareName, BLACK } from '../rules/position.ts';
import { choreograph, previewFlips } from './choreo.ts';

describe('flipTier', () => {
  test('3・5・6・8 枚で段階が上がる', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 12].map(flipTier)).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 4]);
  });
});

describe('hitStopFor', () => {
  test('段階 1 から止め、段階ごとに長くする。段階 0 は止めない', () => {
    expect([2, 3, 5, 6, 8].map((n) => hitStopFor(n, false))).toEqual([0, ...HIT_STOP.byTier.slice(1)]);
  });

  test('8 枚を超えると 1 枚ごとに伸び、上限で止まる。フィーバー中は長くするが、上限は超えない', () => {
    expect(hitStopFor(9, false)).toBeCloseTo(HIT_STOP.byTier[4] + HIT_STOP.perExtraFlip, 9);
    expect(hitStopFor(30, false)).toBe(HIT_STOP.max);
    expect(hitStopFor(3, true)).toBeCloseTo(HIT_STOP.byTier[1] * HIT_STOP.feverScale, 9);
    expect(hitStopFor(30, true)).toBe(HIT_STOP.max);
  });
});

describe('choreograph', () => {
  test('1 枚だけ返る手: 着いてから溜めのあとに返り、余韻で終わる', () => {
    const c = choreograph(play(initialPosition(), parseSquare('f5')), 'human');
    const t = CHOREO.human;
    expect(c.landAt).toBe(t.drop);
    expect(c.waveAt).toBeCloseTo(t.drop + t.holdBase + t.holdPerFlip, 9);
    expect(c.flips).toHaveLength(1);
    expect(squareName(c.flips[0].square)).toBe('e5');
    expect(c.flips[0].start).toBeCloseTo(c.waveAt, 9);
    expect(c.flips[0].dirX).toBe(-1);
    expect(c.flips[0].dirY).toBe(0);
    expect(c.steps).toEqual([{ time: c.flips[0].start + c.flips[0].duration, count: 1, index: 0 }]);
    expect(c.end).toBeCloseTo(c.lastLandAt + t.settle, 9);
    expect([c.count, c.tier]).toEqual([1, 0]);
  });

  // 黒が c4 に打つと、右へ 3 枚（d4 e4 f4）、下へ 2 枚（c5 c6）、右下へ 2 枚（d5 e6）返る
  const wide = positionFromRows(['........', '........', '........', '...OOOX.', '..OO....', '..O.O...', '..X..X..', '........'], BLACK);

  test('複数の方向に返る手の枚数と方向の数', () => {
    const c = choreograph(play(wide, parseSquare('c4')), 'human');
    expect(c.flips.map((f) => squareName(f.square)).sort()).toEqual(['c5', 'c6', 'd4', 'd5', 'e4', 'e6', 'f4']);
    expect([c.count, c.tier]).toEqual([7, 3]);
  });

  test('方向ごとに外へ向かって返り、返り始める順番が後の石ほど高く浮く', () => {
    const r = play(wide, parseSquare('c4'));
    const c = choreograph(r, 'human');
    expect(c.count).toBe(r.lines.reduce((s, l) => s + l.squares.length, 0));
    for (let i = 1; i < c.flips.length; i++) {
      expect(c.flips[i].start).toBeGreaterThanOrEqual(c.flips[i - 1].start);
      expect(c.flips[i].lift).toBeGreaterThanOrEqual(c.flips[i - 1].lift);
      expect(c.flips[i].order).toBe(i);
    }
    // 同じ向きでは、打ったマスに近い石ほど先に返る
    const startOf = (square: number) => c.flips.find((f) => f.square === square)?.start ?? Number.NaN;
    for (const line of r.lines) for (let i = 1; i < line.squares.length; i++) expect(startOf(line.squares[i - 1])).toBeLessThan(startOf(line.squares[i]));
    // まとまりの数の合計は、返る石の数
    expect(c.steps.reduce((s, x) => s + x.count, 0)).toBe(c.count);
    for (let i = 1; i < c.steps.length; i++) expect(c.steps[i].time).toBeGreaterThan(c.steps[i - 1].time);
  });

  test('返る向きはワールド座標（盤の右と上が正）で、押している間の予告の向きと同じ', () => {
    const c = choreograph(play(wide, parseSquare('c4')), 'human');
    const dir = (name: string) => {
      const f = c.flips.find((x) => squareName(x.square) === name);
      return f ? [f.dirX, f.dirY] : null;
    };
    // c5 は c4 の下（行が増える向き）なので、ワールド座標では y が負
    expect(dir('c5')).toEqual([0, -1]);
    expect(dir('d4')).toEqual([1, 0]);
    expect(dir('d5')?.[1]).toBeCloseTo(-Math.SQRT1_2, 9);
    const preview = previewFlips(wide, parseSquare('c4'));
    expect(preview.map((f) => [squareName(f.square), f.dirX, f.dirY]).sort()).toEqual(c.flips.map((f) => [squareName(f.square), f.dirX, f.dirY]).sort());
  });

  test('人の手は、返る順番が進むほど多く回る。CPU の手は回らず、段階も 0', () => {
    const r = play(wide, parseSquare('c4'));
    const human = choreograph(r, 'human');
    const cpu = choreograph(r, 'cpu');
    expect(human.flips[human.count - 1].spins).toBeGreaterThan(0);
    for (const f of cpu.flips) expect(f.spins).toBe(0);
    expect(cpu.tier).toBe(0);
    expect(cpu.landAt).toBeGreaterThan(human.landAt);
  });

  test('返る枚数が多いほど、溜めは長く、返る間隔は短い', () => {
    const t = CHOREO.human;
    const one = choreograph(play(initialPosition(), parseSquare('f5')), 'human');
    const many = choreograph(play(wide, parseSquare('c4')), 'human');
    expect(many.waveAt - many.landAt).toBeGreaterThan(one.waveAt - one.landAt);
    const stepOf = (n: number) => Math.max(t.stepMin, t.stepMax - t.stepPerFlip * n);
    expect(stepOf(many.count)).toBeLessThan(stepOf(one.count));
  });
});
