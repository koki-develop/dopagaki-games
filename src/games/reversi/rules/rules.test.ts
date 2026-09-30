import { describe, expect, test } from 'bun:test';
import { Rng } from '../../../shared/rng.ts';
import { createBits, flipsOf, legalMoves, lowestSquare, popcount, popcount32 } from './bits.ts';
import {
  BLACK,
  countOf,
  discAt,
  flipLines,
  initialPosition,
  isCorner,
  parseSquare,
  play,
  positionFromRows,
  resultOf,
  squareName,
  squaresOf,
  stableDiscs,
  WHITE,
} from './position.ts';
import type { Position } from './position.ts';
import { isOver, legalSquares, naiveFlips, naiveMoves, rowsOf } from './reference.test-support.ts';

const names = (squares: readonly number[]) => squares.map(squareName).sort();

/** 乱数で最後まで打ち進め、途中の局面を順に返す */
function randomGame(seed: number): Position[] {
  const rng = new Rng(seed);
  const out: Position[] = [];
  let p = initialPosition();
  for (;;) {
    out.push(p);
    const moves = legalSquares(p);
    if (moves.length === 0) break;
    const r = play(p, moves[Math.floor(rng.next() * moves.length)]);
    p = r.position;
    if (r.over) {
      out.push(p);
      break;
    }
  }
  return out;
}

describe('bits', () => {
  test('popcount と一番小さいマス', () => {
    expect(popcount32(0)).toBe(0);
    expect(popcount32(-1)).toBe(32);
    expect(popcount32(0x80000001)).toBe(2);
    expect(popcount(-1, 0x0f)).toBe(36);
    expect(lowestSquare(0, 0)).toBe(-1);
    expect(lowestSquare(0, 1 << 31)).toBe(31);
    expect(lowestSquare(1 << 31, 0)).toBe(63);
    expect(lowestSquare(1, 0b1000)).toBe(3);
  });
});

describe('記法と初期配置', () => {
  test('四隅は a1・h1・a8・h8 だけ', () => {
    const corners: string[] = [];
    for (let s = 0; s < 64; s++) if (isCorner(s)) corners.push(squareName(s));
    expect(corners).toEqual(['a1', 'h1', 'a8', 'h8']);
  });

  test('a1 は左上、h8 は右下', () => {
    expect(parseSquare('a1')).toBe(0);
    expect(parseSquare('h1')).toBe(7);
    expect(parseSquare('a8')).toBe(56);
    expect(parseSquare('h8')).toBe(63);
    expect(parseSquare('i1')).toBe(-1);
    for (let s = 0; s < 64; s++) expect(parseSquare(squareName(s))).toBe(s);
  });

  test('d4・e5 が白、e4・d5 が黒で、黒の初手は c4・d3・e6・f5', () => {
    const p = initialPosition();
    expect(discAt(p, parseSquare('d4'))).toBe(WHITE);
    expect(discAt(p, parseSquare('e5'))).toBe(WHITE);
    expect(discAt(p, parseSquare('e4'))).toBe(BLACK);
    expect(discAt(p, parseSquare('d5'))).toBe(BLACK);
    expect(p.turn).toBe(BLACK);
    expect(names(legalSquares(p))).toEqual(['c4', 'd3', 'e6', 'f5']);
  });

  test('f5 は e5 を返し、白の応手は d6・f4・f6', () => {
    const r = play(initialPosition(), parseSquare('f5'));
    expect(names(squaresOf(r.flipped))).toEqual(['e5']);
    expect(r.position.turn).toBe(WHITE);
    expect(names(legalSquares(r.position))).toEqual(['d6', 'f4', 'f6']);
    expect(countOf(r.position, BLACK)).toBe(4);
    expect(countOf(r.position, WHITE)).toBe(1);
  });

  test('合法でない手は投げる', () => {
    expect(() => play(initialPosition(), parseSquare('a1'))).toThrow();
    expect(() => play(initialPosition(), parseSquare('d4'))).toThrow();
    expect(() => play(initialPosition(), 64)).toThrow();
  });
});

/** 局面 p から depth 手先までの局面の数（perft）。終局した局面はそこで 1 つと数える */
function perft(p: Position, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const s of legalSquares(p)) {
    const r = play(p, s);
    n += r.over ? 1 : perft(r.position, depth - 1);
  }
  return n;
}

describe('perft', () => {
  test('初期配置から 7 手先までの局面の数が、知られている値（OEIS A124004）と一致する', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => perft(initialPosition(), d))).toEqual([4, 12, 56, 244, 1396, 8200, 55092]);
  });
});

describe('ビットボードと素朴な実装の突き合わせ', () => {
  test('ランダムに打ち進めたすべての局面で、両方の色の合法手と返る石が一致する', () => {
    let checked = 0;
    for (let seed = 1; seed <= 120; seed++) {
      for (const p of randomGame(seed)) {
        for (const color of [BLACK, WHITE] as const) {
          const m = color === BLACK ? p.black : p.white;
          const o = color === BLACK ? p.white : p.black;
          const moves = squaresOf(legalMoves(m.hi, m.lo, o.hi, o.lo, createBits()));
          expect(moves).toEqual(naiveMoves(p, color));
          for (let s = 0; s < 64; s++) {
            if (discAt(p, s) !== -1) continue;
            expect(squaresOf(flipsOf(m.hi, m.lo, o.hi, o.lo, s, createBits()))).toEqual(naiveFlips(p, color, s));
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  test('端の列をまたいで折り返さない', () => {
    // h1 の黒から右へずらすと a2 に回り込むが、a2 の白は挟めない
    const p = positionFromRows(['.......X', 'OX......', '........', '........', '........', '........', '........', '........'], BLACK);
    expect(naiveMoves(p)).toEqual(squaresOf(legalMoves(p.black.hi, p.black.lo, p.white.hi, p.white.lo, createBits())));
  });
});

describe('play', () => {
  test('方向ごとの並びは、打ったマスに近い順', () => {
    const p = positionFromRows(['........', '........', '..X.....', '...O....', '....O...', '.XOOO...', '........', '........'], BLACK);
    const s = parseSquare('f6');
    const lines = flipLines(p, s);
    const byDir = new Map(lines.map((l) => [`${l.dx},${l.dy}`, l.squares.map(squareName)]));
    expect(byDir.get('-1,0')).toEqual(['e6', 'd6', 'c6']);
    expect(byDir.get('-1,-1')).toEqual(['e5', 'd4']);
    expect(byDir.size).toBe(2);
  });

  test('相手が打てなければ相手はパスし、打った側の手番のまま', () => {
    // 黒が a3 に打つと、白は残りの h8 に打てないが、黒は打てる
    const p = positionFromRows(['OOOOOXXO', 'XOOOXXXO', '.OXXOXXO', 'OOOOOXOO', 'OOOXOOXO', 'XXOXOOOO', 'XOOOOOOO', 'XOOOOOO.'], BLACK);
    const r = play(p, parseSquare('a3'));
    expect(r.passed).toBe(WHITE);
    expect(r.over).toBe(false);
    expect(r.position.turn).toBe(BLACK);
    expect(naiveMoves(r.position, WHITE)).toEqual([]);
    expect(names(legalSquares(r.position))).toEqual(['h8']);
  });

  test('どちらも打てなくなれば終局', () => {
    const p = positionFromRows(['XXX.....', '........', '........', '........', '........', '........', '........', '.....OOO'], WHITE);
    expect(isOver(p)).toBe(true);
  });

  test('ランダムな対局はどれも終局まで進み、パスの扱いが規則どおり', () => {
    for (let seed = 200; seed < 260; seed++) {
      let p = initialPosition();
      let plies = 0;
      for (;;) {
        const moves = legalSquares(p);
        expect(moves.length).toBeGreaterThan(0);
        const r = play(p, moves[seed % moves.length]);
        plies++;
        if (r.passed !== null) expect(naiveMoves(r.position, r.passed)).toEqual([]);
        if (r.over) {
          expect(isOver(r.position)).toBe(true);
          break;
        }
        expect(naiveMoves(r.position).length).toBeGreaterThan(0);
        p = r.position;
      }
      expect(plies).toBeLessThanOrEqual(60);
    }
  });
});

describe('resultOf', () => {
  test('石の数で勝敗を決め、同じ数なら引き分け', () => {
    const win = positionFromRows(['XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXOOO', 'OOOOOOOO', '........', '........', '........'], BLACK);
    expect(resultOf(win)).toEqual({ black: 29, white: 11, winner: BLACK });
    const draw = positionFromRows(['XXXXXXXX', 'XXXXXXXX', 'OOOOOOOO', 'OOOOOOOO', '........', '........', '........', '........'], BLACK);
    expect(resultOf(draw)).toEqual({ black: 16, white: 16, winner: null });
  });
});

describe('stableDiscs', () => {
  const stableNames = (p: Position) => {
    const out = stableDiscs(p, { black: createBits(), white: createBits() });
    return { black: names(squaresOf(out.black)), white: names(squaresOf(out.white)) };
  };

  test('角の石と、角から同じ色で続く辺の石は確定石', () => {
    const p = positionFromRows(['XXXO....', 'X.......', '........', '........', '........', '........', '........', '.......O'], BLACK);
    const s = stableNames(p);
    expect(s.black).toEqual(['a1', 'a2', 'b1', 'c1']);
    expect(s.white).toEqual(['h8']);
  });

  test('初期配置には確定石がない', () => {
    expect(stableNames(initialPosition())).toEqual({ black: [], white: [] });
  });

  test('埋まった盤はすべて確定石', () => {
    const rows = Array.from({ length: 8 }, (_, r) => (r % 2 === 0 ? 'XOXOXOXO' : 'OXOXOXOX'));
    const s = stableNames(positionFromRows(rows, BLACK));
    expect(s.black.length + s.white.length).toBe(64);
  });

  test('確定石と判定した石は、その後の対局で一度も返らない', () => {
    let marked = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const game = randomGame(seed);
      for (let i = 0; i < game.length; i++) {
        const out = stableDiscs(game[i], { black: createBits(), white: createBits() });
        const stable = [...squaresOf(out.black).map((s) => [s, BLACK] as const), ...squaresOf(out.white).map((s) => [s, WHITE] as const)];
        marked += stable.length;
        for (let j = i + 1; j < game.length; j++) {
          for (const [s, color] of stable) {
            if (discAt(game[j], s) !== color) throw new Error(`stable disc ${squareName(s)} flipped\n${rowsOf(game[i]).join('\n')}`);
          }
        }
      }
    }
    expect(marked).toBeGreaterThan(1000);
  });
});
