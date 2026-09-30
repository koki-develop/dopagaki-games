/**
 * 8 × 8 の盤のビットボード。マス s（0〜63）は s = 行 × 8 + 列 で、行 0 は盤の上端（記法の 1）、列 0 は左端（記法の a）。
 * 64 ビットを 32 ビット整数 2 つで持つ。lo はマス 0〜31（1〜4 行）、hi はマス 32〜63（5〜8 行）。
 *
 * 探索で大量に呼ぶので、関数は数値だけを受け取り、結果は呼び出し側が使い回す Bits へ書く。オブジェクトを作らない。
 * 32 ビット整数のビット演算の結果は符号付きになることがあるが、0 かどうかと popcount しか見ないので構わない。
 */

/** 64 ビットの集合。hi と lo は 32 ビット整数 */
export type Bits = { hi: number; lo: number };

export const createBits = (hi = 0, lo = 0): Bits => ({ hi, lo });

/** 横と斜めの向きで、挟まれうる（a 列と h 列を除く）マス。32 ビットの半分ずつに同じ値を使う */
const INNER_COLUMNS = 0x7e7e7e7e;

/** 盤の 8 方向。dx は列、dy は行の増分で、shift はマスの番号の増分（dy × 8 + dx） */
export const DIRECTIONS: readonly { readonly dx: number; readonly dy: number; readonly shift: number }[] = [
  { dx: 1, dy: 0, shift: 1 },
  { dx: -1, dy: 0, shift: -1 },
  { dx: 0, dy: 1, shift: 8 },
  { dx: 0, dy: -1, shift: -8 },
  { dx: 1, dy: 1, shift: 9 },
  { dx: -1, dy: -1, shift: -9 },
  { dx: -1, dy: 1, shift: 7 },
  { dx: 1, dy: -1, shift: -7 },
];

/** 32 ビット整数の立っているビットの数 */
export function popcount32(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export const popcount = (hi: number, lo: number): number => popcount32(hi) + popcount32(lo);

/** 一番小さいマスの番号。空なら -1 */
export function lowestSquare(hi: number, lo: number): number {
  if (lo !== 0) return 31 - Math.clz32(lo & -lo);
  if (hi !== 0) return 63 - Math.clz32(hi & -hi);
  return -1;
}

/** マス s が集合 (hi, lo) に入っているか */
export const hasSquare = (hi: number, lo: number, s: number): boolean => (s < 32 ? (lo >>> s) & 1 : (hi >>> (s - 32)) & 1) === 1;

/**
 * 手番の側（p）が打てるマス。横と斜めの向きでは、相手の石のうち a 列・h 列のものは挟めないので伝わらせない。
 * そうしておくと、伝わった石は内側の列にだけあり、ずらしても行をまたいで折り返さない。
 */
export function legalMoves(pHi: number, pLo: number, oHi: number, oLo: number, out: Bits): Bits {
  const emptyHi = ~(pHi | oHi);
  const emptyLo = ~(pLo | oLo);
  const iHi = oHi & INNER_COLUMNS;
  const iLo = oLo & INNER_COLUMNS;
  let mHi = 0;
  let mLo = 0;
  let tHi: number;
  let tLo: number;
  let nHi: number;

  // +1（右）
  tHi = ((pHi << 1) | (pLo >>> 31)) & iHi;
  tLo = (pLo << 1) & iLo;
  for (let k = 0; k < 5; k++) {
    nHi = ((tHi << 1) | (tLo >>> 31)) & iHi;
    tLo |= (tLo << 1) & iLo;
    tHi |= nHi;
  }
  mHi |= ((tHi << 1) | (tLo >>> 31)) & emptyHi;
  mLo |= (tLo << 1) & emptyLo;

  // -1（左）
  tLo = ((pLo >>> 1) | (pHi << 31)) & iLo;
  tHi = (pHi >>> 1) & iHi;
  for (let k = 0; k < 5; k++) {
    const nLo = ((tLo >>> 1) | (tHi << 31)) & iLo;
    tHi |= (tHi >>> 1) & iHi;
    tLo |= nLo;
  }
  mLo |= ((tLo >>> 1) | (tHi << 31)) & emptyLo;
  mHi |= (tHi >>> 1) & emptyHi;

  // +8（下）
  tHi = ((pHi << 8) | (pLo >>> 24)) & oHi;
  tLo = (pLo << 8) & oLo;
  for (let k = 0; k < 5; k++) {
    nHi = ((tHi << 8) | (tLo >>> 24)) & oHi;
    tLo |= (tLo << 8) & oLo;
    tHi |= nHi;
  }
  mHi |= ((tHi << 8) | (tLo >>> 24)) & emptyHi;
  mLo |= (tLo << 8) & emptyLo;

  // -8（上）
  tLo = ((pLo >>> 8) | (pHi << 24)) & oLo;
  tHi = (pHi >>> 8) & oHi;
  for (let k = 0; k < 5; k++) {
    const nLo = ((tLo >>> 8) | (tHi << 24)) & oLo;
    tHi |= (tHi >>> 8) & oHi;
    tLo |= nLo;
  }
  mLo |= ((tLo >>> 8) | (tHi << 24)) & emptyLo;
  mHi |= (tHi >>> 8) & emptyHi;

  // +9（右下）
  tHi = ((pHi << 9) | (pLo >>> 23)) & iHi;
  tLo = (pLo << 9) & iLo;
  for (let k = 0; k < 5; k++) {
    nHi = ((tHi << 9) | (tLo >>> 23)) & iHi;
    tLo |= (tLo << 9) & iLo;
    tHi |= nHi;
  }
  mHi |= ((tHi << 9) | (tLo >>> 23)) & emptyHi;
  mLo |= (tLo << 9) & emptyLo;

  // -9（左上）
  tLo = ((pLo >>> 9) | (pHi << 23)) & iLo;
  tHi = (pHi >>> 9) & iHi;
  for (let k = 0; k < 5; k++) {
    const nLo = ((tLo >>> 9) | (tHi << 23)) & iLo;
    tHi |= (tHi >>> 9) & iHi;
    tLo |= nLo;
  }
  mLo |= ((tLo >>> 9) | (tHi << 23)) & emptyLo;
  mHi |= (tHi >>> 9) & emptyHi;

  // +7（左下）
  tHi = ((pHi << 7) | (pLo >>> 25)) & iHi;
  tLo = (pLo << 7) & iLo;
  for (let k = 0; k < 5; k++) {
    nHi = ((tHi << 7) | (tLo >>> 25)) & iHi;
    tLo |= (tLo << 7) & iLo;
    tHi |= nHi;
  }
  mHi |= ((tHi << 7) | (tLo >>> 25)) & emptyHi;
  mLo |= (tLo << 7) & emptyLo;

  // -7（右上）
  tLo = ((pLo >>> 7) | (pHi << 25)) & iLo;
  tHi = (pHi >>> 7) & iHi;
  for (let k = 0; k < 5; k++) {
    const nLo = ((tLo >>> 7) | (tHi << 25)) & iLo;
    tHi |= (tHi >>> 7) & iHi;
    tLo |= nLo;
  }
  mLo |= ((tLo >>> 7) | (tHi << 25)) & emptyLo;
  mHi |= (tHi >>> 7) & emptyHi;

  out.hi = mHi;
  out.lo = mLo;
  return out;
}

/** (hi, lo) を n マスぶん番号の大きい向きへずらした hi（n は 1〜31） */
const upHi = (hi: number, lo: number, n: number): number => (hi << n) | (lo >>> (32 - n));
/** (hi, lo) を n マスぶん番号の小さい向きへずらした lo（n は 1〜31） */
const downLo = (hi: number, lo: number, n: number): number => (lo >>> n) | (hi << (32 - n));

/**
 * 手番の側（p）がマス s に打ったときに返る相手の石。s は空きマスであること（合法手でなければ空の集合になる）。
 * 相手の石は、横と斜めでは内側の列のものだけをたどる（legalMoves と同じ理由）。
 */
export function flipsOf(pHi: number, pLo: number, oHi: number, oLo: number, s: number, out: Bits): Bits {
  let fHi = 0;
  let fLo = 0;
  const bHi = s < 32 ? 0 : 1 << (s - 32);
  const bLo = s < 32 ? 1 << s : 0;
  for (let d = 0; d < 8; d++) {
    const shift = DIRECTIONS[d].shift;
    const vertical = shift === 8 || shift === -8;
    const mHi = vertical ? oHi : oHi & INNER_COLUMNS;
    const mLo = vertical ? oLo : oLo & INNER_COLUMNS;
    let aHi = 0;
    let aLo = 0;
    let cHi: number;
    let cLo: number;
    if (shift > 0) {
      cHi = upHi(bHi, bLo, shift);
      cLo = bLo << shift;
      while (((cHi & mHi) | (cLo & mLo)) !== 0) {
        aHi |= cHi;
        aLo |= cLo;
        const h = upHi(cHi, cLo, shift);
        cLo <<= shift;
        cHi = h;
      }
    } else {
      const n = -shift;
      cLo = downLo(bHi, bLo, n);
      cHi = bHi >>> n;
      while (((cHi & mHi) | (cLo & mLo)) !== 0) {
        aHi |= cHi;
        aLo |= cLo;
        const l = downLo(cHi, cLo, n);
        cHi >>>= n;
        cLo = l;
      }
    }
    if (((cHi & pHi) | (cLo & pLo)) !== 0) {
      fHi |= aHi;
      fLo |= aLo;
    }
  }
  out.hi = fHi;
  out.lo = fLo;
  return out;
}
