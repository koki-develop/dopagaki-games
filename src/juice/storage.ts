/** 保存先として使う Storage の一部 */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** `storage` イベントの届け先。ブラウザでは window */
export type StorageEventSource = {
  addEventListener(type: 'storage', listener: (e: { readonly key: string | null }) => void): void;
  removeEventListener(type: 'storage', listener: (e: { readonly key: string | null }) => void): void;
};

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

/** 別のタブでの保存を知らせる `storage` イベントの発生元。ブラウザでは window、ない環境では null */
export function windowEvents(): StorageEventSource | null {
  return typeof window !== 'undefined' ? window : null;
}
