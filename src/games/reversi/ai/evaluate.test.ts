import { describe, expect, test } from 'bun:test';
import { createBits, legalMoves } from '../rules/bits.ts';
import { BLACK, positionFromRows } from '../rules/position.ts';
import { evaluate } from './evaluate.ts';
import { randomPositions, sides, TRANSFORMS, transformed } from './positions.test-support.ts';

describe('evaluate', () => {
  test('盤の回転と反転で値が変わらない', () => {
    for (const p of [...randomPositions(3), ...randomPositions(4)]) {
      const [a, b, c, d] = sides(p);
      const m = legalMoves(a, b, c, d, createBits());
      const base = evaluate(a, b, c, d, m.hi, m.lo);
      for (const t of TRANSFORMS) {
        const q = transformed(p, t);
        const [a2, b2, c2, d2] = sides(q);
        const m2 = legalMoves(a2, b2, c2, d2, createBits());
        expect(evaluate(a2, b2, c2, d2, m2.hi, m2.lo)).toBe(base);
      }
    }
  });

  test('角を持っている側を高く見る', () => {
    const p = positionFromRows(['X.......', '........', '..OOO...', '..OXO...', '..OOO...', '........', '........', '........'], BLACK);
    const [a, b, c, d] = sides(p);
    const m = legalMoves(a, b, c, d, createBits());
    expect(evaluate(a, b, c, d, m.hi, m.lo)).toBeGreaterThan(0);
  });
});
