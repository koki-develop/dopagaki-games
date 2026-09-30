import { createBits, DIRECTIONS, flipsOf, hasSquare, legalMoves, lowestSquare, popcount } from './bits.ts';
import type { Bits } from './bits.ts';

/**
 * 石の色。黒が先手。
 * 数値にしておくと、配列の添字や演出の値（シェーダー）へそのまま渡せる
 */
export const BLACK = 0;
export const WHITE = 1;
export type Color = typeof BLACK | typeof WHITE;

export const opponentOf = (c: Color): Color => (c === BLACK ? WHITE : BLACK);

export const BOARD_SIZE = 8;
export const SQUARES = 64;

/** 局面。石の配置と手番。作ったあとは変えない */
export type Position = {
  readonly black: Readonly<Bits>;
  readonly white: Readonly<Bits>;
  /** 次に打つ側 */
  readonly turn: Color;
};

export const squareOf = (col: number, row: number): number => row * BOARD_SIZE + col;
export const colOf = (s: number): number => s % BOARD_SIZE;
export const rowOf = (s: number): number => Math.floor(s / BOARD_SIZE);

/** 盤の四隅（a1・h1・a8・h8）のマスか */
export const isCorner = (s: number): boolean => s === 0 || s === BOARD_SIZE - 1 || s === SQUARES - BOARD_SIZE || s === SQUARES - 1;

/** マスの記法。列は a〜h（左から）、行は 1〜8（上から）。a1 は左上 */
export const squareName = (s: number): string => `${String.fromCharCode(97 + colOf(s))}${rowOf(s) + 1}`;

/** 記法からマスの番号。読めなければ -1 */
export function parseSquare(name: string): number {
  const m = /^([a-h])([1-8])$/.exec(name);
  if (!m) return -1;
  return squareOf(m[1].charCodeAt(0) - 97, Number(m[2]) - 1);
}

/** 世界オセロ連盟の規則の初期配置。d4 と e5 に白、e4 と d5 に黒。黒から打つ */
export function initialPosition(): Position {
  const black = createBits();
  const white = createBits();
  for (const s of [parseSquare('e4'), parseSquare('d5')]) setSquare(black, s);
  for (const s of [parseSquare('d4'), parseSquare('e5')]) setSquare(white, s);
  return { black, white, turn: BLACK };
}

function setSquare(b: Bits, s: number): void {
  if (s < 32) b.lo |= 1 << s;
  else b.hi |= 1 << (s - 32);
}

/** 石の配置を文字列から作る。8 行の各 8 文字で、X が黒、O が白、. が空き。手番は turn */
export function positionFromRows(rows: readonly string[], turn: Color): Position {
  if (rows.length !== BOARD_SIZE || rows.some((r) => r.length !== BOARD_SIZE)) throw new Error('position must be 8 rows of 8 cells');
  const black = createBits();
  const white = createBits();
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const ch = rows[row][col];
      if (ch === 'X') setSquare(black, squareOf(col, row));
      else if (ch === 'O') setSquare(white, squareOf(col, row));
      else if (ch !== '.') throw new Error(`unknown cell "${ch}"`);
    }
  }
  return { black, white, turn };
}

/** マス s の石の色。空きなら -1 */
export function discAt(p: Position, s: number): Color | -1 {
  if (hasSquare(p.black.hi, p.black.lo, s)) return BLACK;
  if (hasSquare(p.white.hi, p.white.lo, s)) return WHITE;
  return -1;
}

const own = (p: Position, c: Color): Readonly<Bits> => (c === BLACK ? p.black : p.white);

/** 色 c の石の数 */
export const countOf = (p: Position, c: Color): number => {
  const b = own(p, c);
  return popcount(b.hi, b.lo);
};

export const emptyCount = (p: Position): number => SQUARES - countOf(p, BLACK) - countOf(p, WHITE);

/** 色 c が打てるマスの集合 */
export function movesFor(p: Position, c: Color, out: Bits = createBits()): Bits {
  const m = own(p, c);
  const o = own(p, opponentOf(c));
  return legalMoves(m.hi, m.lo, o.hi, o.lo, out);
}

/** 集合のマスの番号（小さい順） */
export function squaresOf(b: Readonly<Bits>): number[] {
  const out: number[] = [];
  let hi = b.hi;
  let lo = b.lo;
  for (let s = lowestSquare(hi, lo); s >= 0; s = lowestSquare(hi, lo)) {
    out.push(s);
    if (s < 32) lo &= lo - 1;
    else hi &= hi - 1;
  }
  return out;
}

export const isLegal = (p: Position, s: number): boolean => {
  if (!Number.isInteger(s) || s < 0 || s >= SQUARES) return false;
  const m = movesFor(p, p.turn);
  return hasSquare(m.hi, m.lo, s);
};

/**
 * 1 方向に返る石の並び。squares は打ったマスに近い順。
 * dx・dy はその方向（DIRECTIONS と同じ）
 */
export type FlipLine = { readonly dx: number; readonly dy: number; readonly squares: readonly number[] };

/** 手番の側がマス s に打ったときに返る石を、方向ごとに打ったマスに近い順で並べる。返る石のない方向は含めない */
export function flipLines(p: Position, s: number): FlipLine[] {
  const color = p.turn;
  const col = colOf(s);
  const row = rowOf(s);
  const lines: FlipLine[] = [];
  for (const d of DIRECTIONS) {
    const run: number[] = [];
    let c = col + d.dx;
    let r = row + d.dy;
    while (c >= 0 && c < BOARD_SIZE && r >= 0 && r < BOARD_SIZE && discAt(p, squareOf(c, r)) === opponentOf(color)) {
      run.push(squareOf(c, r));
      c += d.dx;
      r += d.dy;
    }
    const closed = c >= 0 && c < BOARD_SIZE && r >= 0 && r < BOARD_SIZE && discAt(p, squareOf(c, r)) === color;
    if (closed && run.length > 0) lines.push({ dx: d.dx, dy: d.dy, squares: run });
  }
  return lines;
}

/** 着手の結果 */
export type MoveOutcome = {
  /** 手番を進めた後の局面。相手がパスするときは、打った側の手番のまま */
  readonly position: Position;
  readonly color: Color;
  readonly square: number;
  readonly flipped: Readonly<Bits>;
  readonly lines: readonly FlipLine[];
  /** この手の後にパスした側。いなければ null */
  readonly passed: Color | null;
  /** どちらも打てなくなった（終局） */
  readonly over: boolean;
};

/**
 * 手番の側がマス s に打つ。合法手でなければ投げる。
 * 石を返したあと、相手が打てれば相手の手番にする。相手が打てず自分が打てれば、相手はパスして自分の手番のまま。
 * どちらも打てなければ終局。
 */
export function play(p: Position, s: number): MoveOutcome {
  if (!isLegal(p, s)) throw new Error(`illegal move ${Number.isInteger(s) && s >= 0 && s < SQUARES ? squareName(s) : String(s)}`);
  const color = p.turn;
  const m = own(p, color);
  const o = own(p, opponentOf(color));
  const flipped = flipsOf(m.hi, m.lo, o.hi, o.lo, s, createBits());
  const lines = flipLines(p, s);
  const placedHi = s < 32 ? 0 : 1 << (s - 32);
  const placedLo = s < 32 ? 1 << s : 0;
  const mine = createBits(m.hi | flipped.hi | placedHi, m.lo | flipped.lo | placedLo);
  const theirs = createBits(o.hi & ~flipped.hi, o.lo & ~flipped.lo);
  const board = color === BLACK ? { black: mine, white: theirs } : { black: theirs, white: mine };
  const next: Position = { ...board, turn: opponentOf(color) };
  const oppMoves = movesFor(next, opponentOf(color));
  if ((oppMoves.hi | oppMoves.lo) !== 0) return { position: next, color, square: s, flipped, lines, passed: null, over: false };
  const myMoves = movesFor(next, color);
  if ((myMoves.hi | myMoves.lo) !== 0) {
    return { position: { ...board, turn: color }, color, square: s, flipped, lines, passed: opponentOf(color), over: false };
  }
  return { position: next, color, square: s, flipped, lines, passed: null, over: true };
}

/** 終局の結果。勝敗は石の数で決める */
type GameResult = {
  black: number;
  white: number;
  /** 勝った側。引き分けは null */
  winner: Color | null;
};

export function resultOf(p: Position): GameResult {
  const black = countOf(p, BLACK);
  const white = countOf(p, WHITE);
  return { black, white, winner: black === white ? null : black > white ? BLACK : WHITE };
}

/** 線の 4 本の向き（横・縦・2 本の斜め） */
const AXES: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

const onBoard = (c: number, r: number): boolean => c >= 0 && c < BOARD_SIZE && r >= 0 && r < BOARD_SIZE;

/**
 * 確定石（この先どう打っても返らない石）。out の black・white に書く。
 * 4 本の線のそれぞれで、次のどれかが成り立つ石を確定石とし、変わらなくなるまで広げる:
 * - その線に空きマスがない（その線の上には誰も打てない）
 * - 線の片側の隣が、盤の外か、同じ色の確定石（その線では挟めない）
 * 漏れはある（本当は返らない石を確定石と判定しないことがある）が、返りうる石を確定石と判定することはない。
 */
export function stableDiscs(p: Position, out: { black: Bits; white: Bits }): { black: Bits; white: Bits } {
  const cells = new Int8Array(SQUARES);
  for (let s = 0; s < SQUARES; s++) cells[s] = discAt(p, s);
  const stable = new Uint8Array(SQUARES);
  const full = new Uint8Array(SQUARES * AXES.length);
  for (let s = 0; s < SQUARES; s++) {
    for (let a = 0; a < AXES.length; a++) {
      const [dx, dy] = AXES[a];
      let filled = true;
      for (const sign of [1, -1]) {
        let c = colOf(s) + dx * sign;
        let r = rowOf(s) + dy * sign;
        while (filled && onBoard(c, r)) {
          if (cells[squareOf(c, r)] < 0) filled = false;
          c += dx * sign;
          r += dy * sign;
        }
      }
      full[s * AXES.length + a] = filled ? 1 : 0;
    }
  }
  const safeSide = (c: number, r: number, color: number): boolean => !onBoard(c, r) || (cells[squareOf(c, r)] === color && stable[squareOf(c, r)] === 1);
  let changed = true;
  while (changed) {
    changed = false;
    for (let s = 0; s < SQUARES; s++) {
      const color = cells[s];
      if (color < 0 || stable[s] === 1) continue;
      let ok = true;
      for (let a = 0; a < AXES.length && ok; a++) {
        if (full[s * AXES.length + a] === 1) continue;
        const [dx, dy] = AXES[a];
        const c = colOf(s);
        const r = rowOf(s);
        ok = safeSide(c + dx, r + dy, color) || safeSide(c - dx, r - dy, color);
      }
      if (ok) {
        stable[s] = 1;
        changed = true;
      }
    }
  }
  out.black.hi = out.black.lo = out.white.hi = out.white.lo = 0;
  for (let s = 0; s < SQUARES; s++) {
    if (stable[s] === 0) continue;
    setSquare(cells[s] === BLACK ? out.black : out.white, s);
  }
  return out;
}
