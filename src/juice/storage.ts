/** 保存先として使う Storage の一部 */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** 使えるかどうかを確かめるために読むキー。値があってもなくてもよい */
const PROBE_KEY = 'dopagaki:probe';

/**
 * localStorage を使えるなら返す。使えない（ブロックされている、存在しない）ときは null。
 * 確かめるのは読み出しだけで、書き込みはしない。容量が一杯でも、保存済みの値は読めるようにするため
 */
export function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    const s = window.localStorage;
    if (!s) return null;
    s.getItem(PROBE_KEY);
    return s;
  } catch {
    return null;
  }
}
