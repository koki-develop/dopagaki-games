import { describe, expect, test } from 'bun:test';
import { Rng } from '../../../shared/rng.ts';
import { createBits, legalMoves } from '../rules/bits.ts';
import { BLACK, countOf, initialPosition, isLegal, opponentOf, parseSquare, play, positionFromRows, squareName, WHITE } from '../rules/position.ts';
import type { Color, Position } from '../rules/position.ts';
import { chooseMove } from './cpu.ts';
import { evaluate } from './evaluate.ts';
import { legalSquares } from '../rules/reference.test-support.ts';
import { randomPositions, sides } from './positions.test-support.ts';

const choose = (p: Position, seed: number): number => chooseMove(p, new Rng(seed));

/** me から見た局面 p の値。depth 手先まで読み、読みきった局面は評価し、終局は石の差を大きく見る */
function valueOf(p: Position, me: Color, depth: number): number {
  const moves = legalSquares(p);
  if (moves.length === 0 || depth === 0) {
    const [a, b, c, d] = sides(p);
    const m = legalMoves(a, b, c, d, createBits());
    const v = evaluate(a, b, c, d, m.hi, m.lo);
    return p.turn === me ? v : -v;
  }
  let best = p.turn === me ? -Infinity : Infinity;
  for (const s of moves) {
    const r = play(p, s);
    const v = r.over ? (countOf(r.position, me) - countOf(r.position, opponentOf(me))) * 10_000 : valueOf(r.position, me, depth - 1);
    best = p.turn === me ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

/** 揺らぎなしで、2 手先まで読んで打つ打ち手 */
function steadyMove(p: Position): number {
  let best = -1;
  let top = -Infinity;
  for (const s of legalSquares(p)) {
    const v = valueOf(play(p, s).position, p.turn, 1);
    if (v > top) {
      top = v;
      best = s;
    }
  }
  return best;
}

describe('chooseMove', () => {
  test('どの局面でも合法手を返す', () => {
    for (let seed = 1; seed <= 6; seed++) {
      for (const p of randomPositions(seed)) expect(isLegal(p, choose(p, seed))).toBe(true);
    }
  });

  test('同じ局面と乱数の種なら、同じ手を返す', () => {
    for (const p of randomPositions(31)) expect(choose(p, 9)).toBe(choose(p, 9));
  });

  test('同じ乱数の種で CPU どうしを打たせると、毎回同じ棋譜になる', () => {
    const rng = new Rng(7);
    let p = initialPosition();
    const moves: string[] = [];
    for (;;) {
      const s = chooseMove(p, rng);
      moves.push(squareName(s));
      const r = play(p, s);
      p = r.position;
      if (r.over) break;
    }
    expect(moves.join(' ')).toBe(
      'e6 d6 c5 f6 e7 f4 f3 d8 g3 d7 g7 g4 c7 f5 d3 f7 g6 g5 c8 c6 f8 e8 h6 h4 b7 h5 g8 e3 h3 a8 a6 b8 b6 b4 d2 d1 h7 g2 h1 h8 b5 h2 c1 b1 b3 a4 c3 b2 c4 c2 a3 a2 a1 a5 a7 g1 e1 f2 e2 f1',
    );
    expect([countOf(p, BLACK), countOf(p, WHITE)]).toEqual([20, 44]);
  });

  test('打てる手が 1 つなら、その手を返す', () => {
    // 黒が a3 に打ち、白がパスした局面。黒が打てるのは h8 だけ
    const before = positionFromRows(['OOOOOXXO', 'XOOOXXXO', '.OXXOXXO', 'OOOOOXOO', 'OOOXOOXO', 'XXOXOOOO', 'XOOOOOOO', 'XOOOOOO.'], BLACK);
    const p = play(before, parseSquare('a3')).position;
    expect(legalSquares(p).map(squareName)).toEqual(['h8']);
    for (let seed = 1; seed <= 20; seed++) expect(squareName(choose(p, seed))).toBe('h8');
  });

  test('打てる手がなければ投げる', () => {
    const p = positionFromRows(['XXX.....', '........', '........', '........', '........', '........', '........', '.....OOO'], WHITE);
    expect(() => choose(p, 1)).toThrow();
  });

  test('取れる角は、読まずに打つとき以外はほとんど取る', () => {
    // 白は a1 の角を取れる
    const p = positionFromRows(['.XXXXO..', 'XXO.....', 'X.O.....', 'X...O...', '.O..XO..', '........', '........', '........'], WHITE);
    let corner = 0;
    for (let seed = 1; seed <= 200; seed++) if (squareName(choose(p, seed)) === 'a1') corner++;
    expect(corner).toBeGreaterThan(140);
  });

  test('揺らぎなしで 2 手先まで読む打ち手なら、どの対局も勝てる', () => {
    let wins = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const steadyColor = seed % 2 === 1 ? BLACK : WHITE;
      const rng = new Rng(seed);
      let p = initialPosition();
      for (;;) {
        const s = p.turn === steadyColor ? steadyMove(p) : chooseMove(p, rng);
        const r = play(p, s);
        p = r.position;
        if (r.over) break;
      }
      if (countOf(p, steadyColor) > countOf(p, steadyColor === BLACK ? WHITE : BLACK)) wins++;
    }
    expect(wins).toBe(10);
  });
});
