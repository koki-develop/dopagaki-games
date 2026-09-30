import { BLACK, BOARD_SIZE, discAt, movesFor, opponentOf, squareOf, squaresOf, WHITE } from './position.ts';
import type { Color, Position } from './position.ts';

/** テスト用の素朴な実装。1 マスずつ 8 方向を歩いて、返る石を数える */
export function naiveFlips(p: Position, color: Color, s: number): number[] {
  if (discAt(p, s) !== -1) return [];
  const col = s % BOARD_SIZE;
  const row = Math.floor(s / BOARD_SIZE);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const run: number[] = [];
      let c = col + dx;
      let r = row + dy;
      while (c >= 0 && c < 8 && r >= 0 && r < 8 && discAt(p, squareOf(c, r)) === opponentOf(color)) {
        run.push(squareOf(c, r));
        c += dx;
        r += dy;
      }
      if (run.length > 0 && c >= 0 && c < 8 && r >= 0 && r < 8 && discAt(p, squareOf(c, r)) === color) out.push(...run);
    }
  }
  return out.sort((a, b) => a - b);
}

export function naiveMoves(p: Position, color: Color = p.turn): number[] {
  const out: number[] = [];
  for (let s = 0; s < 64; s++) if (naiveFlips(p, color, s).length > 0) out.push(s);
  return out;
}

/** 盤を 8 行の文字列にする（X 黒、O 白、. 空き） */
export function rowsOf(p: Position): string[] {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let line = '';
    for (let c = 0; c < 8; c++) {
      const d = discAt(p, squareOf(c, r));
      line += d === -1 ? '.' : d === BLACK ? 'X' : 'O';
    }
    rows.push(line);
  }
  return rows;
}

/** 手番の側が打てるマスの番号（小さい順） */
export const legalSquares = (p: Position): number[] => squaresOf(movesFor(p, p.turn));

/** どちらも打てない（終局） */
export function isOver(p: Position): boolean {
  const b = movesFor(p, BLACK);
  const w = movesFor(p, WHITE);
  return (b.hi | b.lo | w.hi | w.lo) === 0;
}
