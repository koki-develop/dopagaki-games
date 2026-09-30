import { describe, expect, test } from 'bun:test';
import { Rng } from '../../shared/rng.ts';
import { Match } from './match.ts';
import { BLACK, countOf, opponentOf, parseSquare, squaresOf, WHITE } from './rules/position.ts';

/** 乱数で終局まで打ち進める */
function playOut(m: Match, seed: number): void {
  const rng = new Rng(seed);
  while (m.turn !== null) {
    const moves = squaresOf(m.legalMoves());
    m.play(moves[Math.floor(rng.next() * moves.length)]);
  }
}

describe('Match', () => {
  test('黒を持てば人の手番から、白を持てば CPU の手番から始まる', () => {
    expect(new Match({ human: BLACK }).turn).toBe('human');
    expect(new Match({ human: WHITE }).turn).toBe('cpu');
  });

  test('打てないマスや終局の後は投げる', () => {
    const m = new Match({ human: BLACK });
    expect(m.canPlay(parseSquare('a1'))).toBe(false);
    expect(() => m.play(parseSquare('a1'))).toThrow();
    playOut(m, 3);
    expect(m.turn).toBeNull();
    expect(squaresOf(m.legalMoves())).toEqual([]);
    expect(() => m.play(0)).toThrow();
  });

  test('判定は人から見た勝敗と石の数', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const human of [BLACK, WHITE] as const) {
        const m = new Match({ human });
        playOut(m, seed);
        const v = m.verdict();
        expect(v.human).toBe(countOf(m.position, human));
        expect(v.cpu).toBe(countOf(m.position, opponentOf(human)));
        expect(v.outcome).toBe(v.human > v.cpu ? 'win' : v.human < v.cpu ? 'lose' : 'draw');
        expect(v.perfect).toBe(v.outcome === 'win' && v.cpu === 0);
      }
    }
  });

  test('終局の前に判定を求めると投げる', () => {
    expect(() => new Match({ human: BLACK }).verdict()).toThrow();
  });
});
