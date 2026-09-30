import type { RunResult } from './types.ts';

/**
 * リバーシの記録の値と、その検証・合成・更新。保存先には触れない（保存は records.ts）。
 * どの記録も、played ≥ wins + losses + draws と perfect ≤ wins を満たす。
 */

/** リバーシの記録 */
export type Records = {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  /** 相手の石を 0 にして勝った回数 */
  perfect: number;
  /** 1 局の得点の最高 */
  bestScore: number;
  /** 最大コンボ */
  maxCombo: number;
};

/** 記録を読み、対局の結果を反映する窓口。React からは useSyncExternalStore で読む */
export interface RecordsStore {
  get(): Records;
  subscribe(listener: () => void): () => void;
  /** 結果を反映して保存する。手元の値を保存先の値と合わせてから結果を当てるので、別のタブの記録を消さない */
  commit(result: RunResult): void;
  dispose(): void;
}

export const emptyRecords = (): Records => ({
  played: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  perfect: 0,
  bestScore: 0,
  maxCombo: 0,
});

/** 0 以上の安全な整数だけを受け付ける。負数・NaN・非数・桁あふれした値は 0 として扱う */
const count = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(Math.floor(v)) && v >= 0 ? Math.floor(v) : 0);

/** max を超える値はありえないので、壊れた値として 0 にする */
const bounded = (v: unknown, max: number): number => {
  const n = count(v);
  return n <= max ? n : 0;
};

/** 1 局で人が打てる手の数の上限（コンボの上限） */
const MAX_MOVES = 60;

/** 辻褄を合わせる。対局数は勝ち・負け・引き分けの合計より少なくせず、パーフェクトは勝ちの数を超えさせない */
function consistent(r: Records): Records {
  return {
    ...r,
    played: Math.max(r.played, r.wins + r.losses + r.draws),
    perfect: Math.min(r.perfect, r.wins),
  };
}

/** 保存された記録を検証して取り込む。ありえない値は 0 にし、辻褄の合わない値は直す */
export function sanitizeRecords(raw: Readonly<Record<string, unknown>>): Records {
  return consistent({
    played: count(raw.played),
    wins: count(raw.wins),
    losses: count(raw.losses),
    draws: count(raw.draws),
    perfect: count(raw.perfect),
    bestScore: count(raw.bestScore),
    maxCombo: bounded(raw.maxCombo, MAX_MOVES),
  });
}

/** 2 つの記録を合わせる。数は項目ごとの大きいほうを取り、辻褄を合わせる。どの順で合わせても同じ結果になる */
export function mergeRecords(a: Records, b: Records): Records {
  return consistent({
    played: Math.max(a.played, b.played),
    wins: Math.max(a.wins, b.wins),
    losses: Math.max(a.losses, b.losses),
    draws: Math.max(a.draws, b.draws),
    perfect: Math.max(a.perfect, b.perfect),
    bestScore: Math.max(a.bestScore, b.bestScore),
    maxCombo: Math.max(a.maxCombo, b.maxCombo),
  });
}

const KEYS = Object.keys(emptyRecords()) as (keyof Records)[];

export const sameRecords = (a: Records, b: Records): boolean => KEYS.every((k) => a[k] === b[k]);

/** 対局の結果を記録に反映する */
export function applyResult(r: Records, result: RunResult): Records {
  return {
    played: r.played + 1,
    wins: r.wins + (result.outcome === 'win' ? 1 : 0),
    losses: r.losses + (result.outcome === 'lose' ? 1 : 0),
    draws: r.draws + (result.outcome === 'draw' ? 1 : 0),
    perfect: r.perfect + (result.perfect ? 1 : 0),
    bestScore: Math.max(r.bestScore, result.score.total),
    maxCombo: Math.max(r.maxCombo, result.maxCombo),
  };
}
