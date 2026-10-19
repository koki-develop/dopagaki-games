import type { RunResult } from './types.ts';

/**
 * ブラックジャックの記録の値と、その検証・合成・更新。保存先には触れない（保存は records.ts）。
 * 記録は、タイトルに出す最高スコアだけを持つ。
 */

/** ブラックジャックの記録 */
export type Records = {
  /** 1 回のプレイの最後の手持ちの最高 */
  bestScore: number;
};

/** 記録を読み、プレイの結果を反映する窓口。React からは useSyncExternalStore で読む */
export interface RecordsStore {
  get(): Records;
  subscribe(listener: () => void): () => void;
  /** 結果を反映して保存する。手元の値を保存先の値と合わせてから結果を当てるので、別のタブの記録を消さない */
  commit(result: RunResult): void;
  dispose(): void;
}

export const emptyRecords = (): Records => ({ bestScore: 0 });

/** 0 以上の安全な整数だけを受け付ける。負数・NaN・非数・桁あふれした値は 0 として扱う */
const count = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(Math.floor(v)) && v >= 0 ? Math.floor(v) : 0);

/** 保存された記録を検証して取り込む。ありえない値は 0 にする */
export function sanitizeRecords(raw: Readonly<Record<string, unknown>>): Records {
  return { bestScore: count(raw.bestScore) };
}

/** 2 つの記録を合わせる。大きいほうを取る。どの順で合わせても同じ結果になる */
export function mergeRecords(a: Records, b: Records): Records {
  return { bestScore: Math.max(a.bestScore, b.bestScore) };
}

export const sameRecords = (a: Records, b: Records): boolean => a.bestScore === b.bestScore;

/** プレイの結果を記録に反映する */
export function applyResult(r: Records, result: RunResult): Records {
  return { bestScore: Math.max(r.bestScore, result.score.total) };
}
