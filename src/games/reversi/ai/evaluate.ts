import { createBits, legalMoves, popcount, popcount32 } from '../rules/bits.ts';
import { squareOf as sq } from '../rules/position.ts';

/**
 * 局面の評価（手番の側 p から見た値）。CPU が手を選ぶのに使う。
 * ビットボード（32 ビット整数 2 つずつ）のまま数え、オブジェクトを作らない。
 */

const bitsOfSquares = (squares: readonly number[]): [number, number] => {
  let hi = 0;
  let lo = 0;
  for (const s of squares) {
    if (s < 32) lo |= 1 << s;
    else hi |= 1 << (s - 32);
  }
  return [hi, lo];
};

/** 角、その斜め隣（X）、辺の隣（C）。角ごとに並べる */
const CORNERS = [sq(0, 0), sq(7, 0), sq(0, 7), sq(7, 7)];
const X_SQUARES = [sq(1, 1), sq(6, 1), sq(1, 6), sq(6, 6)];
const C_SQUARES = [
  [sq(1, 0), sq(0, 1)],
  [sq(6, 0), sq(7, 1)],
  [sq(0, 6), sq(1, 7)],
  [sq(7, 6), sq(6, 7)],
];
const [CORNER_HI, CORNER_LO] = bitsOfSquares(CORNERS);
const CORNER_BITS = CORNERS.map((s) => bitsOfSquares([s]));
const X_BITS = X_SQUARES.map((s) => bitsOfSquares([s]));
const C_BITS = C_SQUARES.map((pair) => bitsOfSquares(pair));
/** 辺の A・B（角と C を除く辺の 4 マス） */
const EDGE_SQUARES: number[] = [];
for (let i = 2; i <= 5; i++) EDGE_SQUARES.push(sq(i, 0), sq(i, 7), sq(0, i), sq(7, i));
const [EDGE_HI, EDGE_LO] = bitsOfSquares(EDGE_SQUARES);

/** 左右の端の列を除くマス（横と斜めにずらしたときに行をまたがないように） */
const NOT_A = 0xfefefefe;
const NOT_H = 0x7f7f7f7f;

/** 評価の重み。空きマス 60（序盤）と 0（終局）の間を直線で補う */
type Weights = { corner: number; x: number; c: number; edge: number; mobility: number; potential: number; parity: number; disc: number };
const EARLY: Weights = { corner: 520, x: -260, c: -110, edge: 18, mobility: 70, potential: 22, parity: 0, disc: -4 };
const LATE: Weights = { corner: 420, x: -120, c: -60, edge: 30, mobility: 40, potential: 8, parity: 60, disc: 40 };

/** 空きマスの数ごとの重み（0〜64） */
const PHASES: readonly Weights[] = Array.from({ length: 65 }, (_, e) => {
  const t = Math.min(1, e / 60);
  const lerp = (a: number, b: number) => Math.round(b + (a - b) * t);
  return {
    corner: lerp(EARLY.corner, LATE.corner),
    x: lerp(EARLY.x, LATE.x),
    c: lerp(EARLY.c, LATE.c),
    edge: lerp(EARLY.edge, LATE.edge),
    mobility: lerp(EARLY.mobility, LATE.mobility),
    potential: lerp(EARLY.potential, LATE.potential),
    parity: lerp(EARLY.parity, LATE.parity),
    disc: lerp(EARLY.disc, LATE.disc),
  };
});

/** 石のあるマスの 8 近傍（石のあるマス自身も含むことがある。呼ぶ側が空きマスと重ねて使う） */
function neighborsHi(hi: number, lo: number): number {
  const e = (hi & NOT_H) << 1 | (lo & NOT_H) >>> 31;
  const w = (hi & NOT_A) >>> 1;
  const s = (hi << 8) | (lo >>> 24);
  const n = hi >>> 8;
  const se = ((hi & NOT_H) << 9) | ((lo & NOT_H) >>> 23);
  const sw = ((hi & NOT_A) << 7) | ((lo & NOT_A) >>> 25);
  const ne = (hi & NOT_H) >>> 7;
  const nw = (hi & NOT_A) >>> 9;
  return e | w | s | n | se | sw | ne | nw;
}

function neighborsLo(hi: number, lo: number): number {
  const e = (lo & NOT_H) << 1;
  const w = ((lo & NOT_A) >>> 1) | ((hi & NOT_A) << 31);
  const s = lo << 8;
  const n = (lo >>> 8) | (hi << 24);
  const se = (lo & NOT_H) << 9;
  const sw = (lo & NOT_A) << 7;
  const ne = ((lo & NOT_H) >>> 7) | ((hi & NOT_H) << 25);
  const nw = ((lo & NOT_A) >>> 9) | ((hi & NOT_A) << 23);
  return e | w | s | n | se | sw | ne | nw;
}

/**
 * 中盤の評価（手番の側 p から見た値）。lHi・lLo は p の合法手（求めてあるものを使う）。
 * - 角: 取った角の差
 * - X・C 打ち: 角が空いているときの、その隣の石の差（角を取られる危険）
 * - 辺: 角と C を除く辺の石の差
 * - 着手可能数の差と、潜在的な着手可能数（相手の石に接する空きマス）の差
 * - 偶数理論: 空きマスが奇数なら、最後に打てる見込みがある
 * - 石の差: 序盤は少ないほうがよく、終盤は多いほうがよい
 */
export function evaluate(pHi: number, pLo: number, oHi: number, oLo: number, lHi: number, lLo: number): number {
  const emptyHi = ~(pHi | oHi);
  const emptyLo = ~(pLo | oLo);
  const empties = popcount(emptyHi, emptyLo);
  const w = PHASES[empties];
  let v = 0;

  v += w.corner * (popcount(pHi & CORNER_HI, pLo & CORNER_LO) - popcount(oHi & CORNER_HI, oLo & CORNER_LO));
  for (let i = 0; i < 4; i++) {
    const [ch, cl] = CORNER_BITS[i];
    if (((emptyHi & ch) | (emptyLo & cl)) === 0) continue;
    const [xh, xl] = X_BITS[i];
    const [c2h, c2l] = C_BITS[i];
    v += w.x * (popcount(pHi & xh, pLo & xl) - popcount(oHi & xh, oLo & xl));
    v += w.c * (popcount(pHi & c2h, pLo & c2l) - popcount(oHi & c2h, oLo & c2l));
  }
  v += w.edge * (popcount(pHi & EDGE_HI, pLo & EDGE_LO) - popcount(oHi & EDGE_HI, oLo & EDGE_LO));

  const mine = popcount(lHi, lLo);
  const theirsMoves = legalMoves(oHi, oLo, pHi, pLo, SCRATCH);
  const theirs = popcount(theirsMoves.hi, theirsMoves.lo);
  v += Math.round((w.mobility * 10 * (mine - theirs)) / (mine + theirs + 2));

  const potMine = popcount32(neighborsHi(oHi, oLo) & emptyHi) + popcount32(neighborsLo(oHi, oLo) & emptyLo);
  const potTheirs = popcount32(neighborsHi(pHi, pLo) & emptyHi) + popcount32(neighborsLo(pHi, pLo) & emptyLo);
  v += w.potential * (potMine - potTheirs);

  if (empties % 2 === 1) v += w.parity;
  v += w.disc * (popcount(pHi, pLo) - popcount(oHi, oLo));
  return v;
}

const SCRATCH = createBits();
