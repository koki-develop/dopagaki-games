import { Rng } from '../../../shared/rng.ts';
import { BLACK, initialPosition, play, positionFromRows } from '../rules/position.ts';
import type { Position } from '../rules/position.ts';
import { legalSquares, rowsOf } from '../rules/reference.test-support.ts';

/** 手番の側と相手のビットボード（p の hi, lo, o の hi, lo） */
export const sides = (p: Position) => {
  const me = p.turn === BLACK ? p.black : p.white;
  const op = p.turn === BLACK ? p.white : p.black;
  return [me.hi, me.lo, op.hi, op.lo] as const;
};

/** 乱数で打ち進めた対局の局面 */
export function randomPositions(seed: number): Position[] {
  const rng = new Rng(seed);
  const out: Position[] = [];
  let p = initialPosition();
  for (;;) {
    out.push(p);
    const m = legalSquares(p);
    const r = play(p, m[Math.floor(rng.next() * m.length)]);
    if (r.over) break;
    p = r.position;
  }
  return out;
}

/** 盤の 8 通りの対称。マス (c, r) を移す */
export const TRANSFORMS: ((c: number, r: number) => [number, number])[] = [
  (c, r) => [c, r],
  (c, r) => [7 - c, r],
  (c, r) => [c, 7 - r],
  (c, r) => [7 - c, 7 - r],
  (c, r) => [r, c],
  (c, r) => [7 - r, c],
  (c, r) => [r, 7 - c],
  (c, r) => [7 - r, 7 - c],
];

/** 局面を対称 t で移す */
export function transformed(p: Position, t: (c: number, r: number) => [number, number]): Position {
  const rows = rowsOf(p);
  const out = Array.from({ length: 8 }, () => Array<string>(8).fill('.'));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const [c2, r2] = t(c, r);
      out[r2][c2] = rows[r][c];
    }
  }
  return positionFromRows(
    out.map((l) => l.join('')),
    p.turn,
  );
}
