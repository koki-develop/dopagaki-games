import { describe, expect, test } from 'bun:test';
import { BLACK, parseSquare, play, positionFromRows, WHITE } from './rules/position.ts';
import { StableTracker } from './stable-tracker.ts';

const names = (squares: readonly number[]) => squares.map((s) => `${'abcdefgh'[s % 8]}${Math.floor(s / 8) + 1}`);

describe('StableTracker', () => {
  test('最初の局面ではその時点の確定石を返し、以後は手ごとに新しく確定石になったマスだけを返す', () => {
    // 白が h1 に打つと h2 を返し、1 行目が埋まって黒の b1〜f1 が確定石になる
    const start = positionFromRows(['OXXXXXO.', '.......X', '.......O', '........', '........', '........', '........', '........'], WHITE);
    const tracker = new StableTracker();
    const first = tracker.record(start);
    expect([names(first.black), names(first.white)]).toEqual([[], ['a1']]);
    const r = play(start, parseSquare('h1'));
    const gained = tracker.record(r.position);
    // 相手（白）の手でも、黒の石が確定石になる
    expect(names(gained.black)).toEqual(['b1', 'c1', 'd1', 'e1', 'f1']);
    expect(names(gained.white)).toEqual(['g1', 'h1', 'h2', 'h3']);
    expect(tracker.record(r.position)).toEqual({ black: [], white: [] });
  });

  test('確定石は色ごとに分ける', () => {
    const p = positionFromRows(['X......O', '........', '........', '...XO...', '...OX...', '........', '........', '........'], BLACK);
    const s = new StableTracker().record(p);
    expect([names(s.black), names(s.white)]).toEqual([['a1'], ['h1']]);
  });
});
