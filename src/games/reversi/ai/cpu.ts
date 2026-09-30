import type { Rng } from '../../../shared/rng.ts';
import { createBits, flipsOf, legalMoves, lowestSquare, popcount } from '../rules/bits.ts';
import type { Bits } from '../rules/bits.ts';
import { BLACK, SQUARES } from '../rules/position.ts';
import type { Position } from '../rules/position.ts';
import { evaluate } from './evaluate.ts';

/**
 * CPU の手の選び方。1 手先の局面を評価し、揺らぎを足していちばん高い手を選ぶ。ときどき読まずに打つ。
 * スコアを競うゲームなので、CPU はまともに打てば勝てる強さに留める。
 */
const CPU_PLAY = {
  /** 評価に足す揺らぎの大きさ（評価値の単位。角 1 つの差がおよそ 500） */
  noise: 500,
  /** この確率で、読まずに合法手から一様に選ぶ */
  blunder: 0.25,
} as const;

/** 終局の評価の 1 石あたりの大きさ。どの評価よりも、勝ち負けが決まった局面を優先する */
const TERMINAL_UNIT = 10_000;

const scratch: Bits = createBits();
const flips: Bits = createBits();

/**
 * 局面 position の手番の側が打つマスを選ぶ。打てる手がなければ投げる。
 * 素のモジュールで、同じ局面と同じ乱数の列なら、必ず同じ手を返す。
 */
export function chooseMove(position: Position, rng: Rng): number {
  const me = position.turn === BLACK ? position.black : position.white;
  const op = position.turn === BLACK ? position.white : position.black;
  return chooseFor(me.hi, me.lo, op.hi, op.lo, rng);
}

/** 石 p の側が、石 o の側を相手に打つマスを選ぶ */
function chooseFor(pHi: number, pLo: number, oHi: number, oLo: number, rng: Rng): number {
  const legal = legalMoves(pHi, pLo, oHi, oLo, scratch);
  let hi = legal.hi;
  let lo = legal.lo;
  const count = popcount(hi, lo);
  if (count === 0) throw new Error('no legal move');
  if (rng.next() < CPU_PLAY.blunder) return nthSquare(hi, lo, Math.floor(rng.next() * count));
  if (count === 1) return lowestSquare(hi, lo);

  let best = -1;
  let top = -Infinity;
  while ((hi | lo) !== 0) {
    const s = lowestSquare(hi, lo);
    if (s < 32) lo &= lo - 1;
    else hi &= hi - 1;
    // 2 つの一様乱数の和で、真ん中に寄った揺らぎにする
    const v = valueAfter(pHi, pLo, oHi, oLo, s) + (rng.next() + rng.next() - 1) * CPU_PLAY.noise;
    if (v > top) {
      top = v;
      best = s;
    }
  }
  return best;
}

/** p がマス s に打った後の局面の、p から見た評価 */
function valueAfter(pHi: number, pLo: number, oHi: number, oLo: number, s: number): number {
  const f = flipsOf(pHi, pLo, oHi, oLo, s, flips);
  const nPHi = pHi | f.hi | (s < 32 ? 0 : 1 << (s - 32));
  const nPLo = pLo | f.lo | (s < 32 ? 1 << s : 0);
  const nOHi = oHi & ~f.hi;
  const nOLo = oLo & ~f.lo;
  const theirs = legalMoves(nOHi, nOLo, nPHi, nPLo, scratch);
  if ((theirs.hi | theirs.lo) !== 0) return -evaluate(nOHi, nOLo, nPHi, nPLo, theirs.hi, theirs.lo);
  // 相手がパスする局面は、続けて打つ自分の側から評価する。どちらも打てなければ終局
  const mine = legalMoves(nPHi, nPLo, nOHi, nOLo, scratch);
  if ((mine.hi | mine.lo) !== 0) return evaluate(nPHi, nPLo, nOHi, nOLo, mine.hi, mine.lo);
  return terminalScore(nPHi, nPLo, nOHi, nOLo) * TERMINAL_UNIT;
}

/** 集合の n 番目（小さい順、0 から）のマス */
function nthSquare(hi: number, lo: number, n: number): number {
  let h = hi;
  let l = lo;
  for (let i = 0; i < n; i++) {
    if (l !== 0) l &= l - 1;
    else h &= h - 1;
  }
  return lowestSquare(h, l);
}

/** 終局の石の差。空きマスは勝った側に数える（世界オセロ連盟の公式の得点と同じ） */
function terminalScore(pHi: number, pLo: number, oHi: number, oLo: number): number {
  const p = popcount(pHi, pLo);
  const o = popcount(oHi, oLo);
  const empty = SQUARES - p - o;
  if (p > o) return p - o + empty;
  if (p < o) return p - o - empty;
  return 0;
}
