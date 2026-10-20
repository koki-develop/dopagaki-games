import type { RunResult } from './types.ts';

/**
 * ブラックジャックの記録の値と、その検証・合成・更新。保存先には触れない（保存は records.ts）。
 * 記録は、タイトルに出す最高スコアと、プレイをまたいだ手持ちの増減の累計を持つ。
 */

/**
 * ブラックジャックの記録。
 * 累計は増えも減りもするので、別のタブの記録と大きいほうを取って合わせられるよう、
 * 増やして終えたプレイの増えた分の合計（gained）と、減らして終えたプレイの減った分の合計（lost）に分けて持つ。累計は lifetimeNet で求める
 */
export type Records = {
  /** 1 回のプレイの最後の手持ちの最高 */
  bestScore: number;
  gained: number;
  lost: number;
};

/** 記録を読み、プレイの結果を反映する窓口。React からは useSyncExternalStore で読む */
export interface RecordsStore {
  get(): Records;
  subscribe(listener: () => void): () => void;
  /** 結果を反映して保存する。手元の値を保存先の値と合わせてから結果を当てるので、別のタブの記録を消さない */
  commit(result: RunResult): void;
  dispose(): void;
}

export const emptyRecords = (): Records => ({ bestScore: 0, gained: 0, lost: 0 });

/** 0 以上の安全な整数だけを受け付ける。負数・NaN・非数・桁あふれした値は 0 として扱う */
const count = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(Math.floor(v)) && v >= 0 ? Math.floor(v) : 0);

/** 保存された記録を検証して取り込む。ありえない値は 0 にする */
export function sanitizeRecords(raw: Readonly<Record<string, unknown>>): Records {
  return { bestScore: count(raw.bestScore), gained: count(raw.gained), lost: count(raw.lost) };
}

/** 2 つの記録を合わせる。項目ごとに大きいほうを取る。どの順で合わせても同じ結果になる */
export function mergeRecords(a: Records, b: Records): Records {
  return { bestScore: Math.max(a.bestScore, b.bestScore), gained: Math.max(a.gained, b.gained), lost: Math.max(a.lost, b.lost) };
}

export const sameRecords = (a: Records, b: Records): boolean => a.bestScore === b.bestScore && a.gained === b.gained && a.lost === b.lost;

/** 1 回のプレイの、始めからの手持ちの増減 */
export const runNet = (result: RunResult): number => result.score.total - result.score.start;

/** これまでに最後までやったプレイの、手持ちの増減の累計 */
export const lifetimeNet = (r: Records): number => r.gained - r.lost;

/** プレイの結果を記録に反映する */
export function applyResult(r: Records, result: RunResult): Records {
  const net = runNet(result);
  return {
    bestScore: Math.max(r.bestScore, result.score.total),
    gained: r.gained + Math.max(0, net),
    lost: r.lost + Math.max(0, -net),
  };
}
