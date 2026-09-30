import { createBits, hasSquare } from './rules/bits.ts';
import { SQUARES, stableDiscs } from './rules/position.ts';
import type { Position } from './rules/position.ts';

/** 1 手で新しく確定石になったマス（小さい順）を、石の色ごとに分けたもの */
export type NewStable = {
  readonly black: readonly number[];
  readonly white: readonly number[];
};

/**
 * 1 局の確定石を追う。対局を始める局面を最初に渡し、その後はどちらの手でも打った後の局面を順に渡すと、
 * その手で新しく確定石になったマスを返す（最初に渡した局面では、その時点の確定石をすべて返す）。
 * 確定石（stableDiscs）は返らない石だけを数えるので、一度確定石になった石は同じ色のまま確定石であり続ける。
 * そのため、前の局面との差は、これまでに確定石と判定したマスを覚えておけば求まる。
 */
export class StableTracker {
  private readonly marked = new Uint8Array(SQUARES);
  private readonly out = { black: createBits(), white: createBits() };

  /** 局面 p を渡す。前に渡した局面からの差（新しく確定石になったマス）を返す */
  record(p: Position): NewStable {
    const s = stableDiscs(p, this.out);
    const black: number[] = [];
    const white: number[] = [];
    for (let sq = 0; sq < SQUARES; sq++) {
      if (this.marked[sq]) continue;
      if (hasSquare(s.black.hi, s.black.lo, sq)) black.push(sq);
      else if (hasSquare(s.white.hi, s.white.lo, sq)) white.push(sq);
      else continue;
      this.marked[sq] = 1;
    }
    return { black, white };
  }
}
