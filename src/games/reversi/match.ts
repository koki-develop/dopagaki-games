import { createBits } from './rules/bits.ts';
import type { Bits } from './rules/bits.ts';
import { BLACK, initialPosition, isLegal, movesFor, play, resultOf } from './rules/position.ts';
import type { Color, MoveOutcome, Position } from './rules/position.ts';
import type { MatchSetup, Outcome, Side } from './types.ts';

/** 終局の判定。人から見た勝敗と石の数 */
type MatchVerdict = {
  readonly outcome: Outcome;
  readonly human: number;
  readonly cpu: number;
  /** 相手の石を 0 にして勝った */
  readonly perfect: boolean;
};

/**
 * 1 局の進行。人と CPU のどちらの手番か、着手、パス、終局と判定を扱う。時刻や演出、得点は知らない。
 * 1 局ごとに作る。
 */
export class Match {
  readonly setup: MatchSetup;
  private pos: Position;
  private finished = false;
  private readonly legal: Bits = createBits();

  /** start は始める局面（省略すると初期配置）。手番の側が打てない局面は受け付けない */
  constructor(setup: MatchSetup, start: Position = initialPosition()) {
    const m = movesFor(start, start.turn);
    if ((m.hi | m.lo) === 0) throw new Error('the side to move has no legal move');
    this.setup = setup;
    this.pos = start;
  }

  get position(): Position {
    return this.pos;
  }

  /** 次に打つ側。終局していれば null */
  get turn(): Side | null {
    if (this.finished) return null;
    return this.sideOf(this.pos.turn);
  }

  sideOf(color: Color): Side {
    return color === this.setup.human ? 'human' : 'cpu';
  }

  /** 手番の側が打てるマスの集合。返すオブジェクトは使い回すので、次の着手までに読む */
  legalMoves(): Readonly<Bits> {
    if (this.finished) {
      this.legal.hi = 0;
      this.legal.lo = 0;
      return this.legal;
    }
    return movesFor(this.pos, this.pos.turn, this.legal);
  }

  canPlay(square: number): boolean {
    return !this.finished && isLegal(this.pos, square);
  }

  /** 手番の側がマス square に打つ。打てなければ投げる */
  play(square: number): MoveOutcome {
    if (this.finished) throw new Error('the match is over');
    const r = play(this.pos, square);
    this.pos = r.position;
    this.finished = r.over;
    return r;
  }

  /** 終局の判定。終局していなければ投げる */
  verdict(): MatchVerdict {
    if (!this.finished) throw new Error('the match is not over');
    const s = resultOf(this.pos);
    const human = this.setup.human;
    const black = human === BLACK;
    const humanCount = black ? s.black : s.white;
    const cpuCount = black ? s.white : s.black;
    const outcome: Outcome = s.winner === null ? 'draw' : s.winner === human ? 'win' : 'lose';
    return {
      outcome,
      human: humanCount,
      cpu: cpuCount,
      perfect: outcome === 'win' && cpuCount === 0,
    };
  }
}
