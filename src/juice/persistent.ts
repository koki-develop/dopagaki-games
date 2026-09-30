import type { StorageEventSource, StorageLike } from './storage.ts';

type PersistentOptions<T> = {
  /** 保存先のキー */
  key: string;
  /**
   * 保存する形式の版。形式を変えるときは上げる。版の違う保存内容は読まない。
   * 古い版の保存内容は上書きし、新しい版の保存内容は上書きしない
   */
  version: number;
  storage: StorageLike | null;
  /** 別のタブでの保存を知るための `storage` イベントの発生元 */
  events?: StorageEventSource | null;
  /** 何も保存されていない（読めない）ときの値 */
  empty(): T;
  /** 版が version と同じ保存内容を検証して取り込む。壊れた値や知らない値は捨てる */
  sanitize(saved: Readonly<Record<string, unknown>>): T;
  /**
   * 2 つの値を合わせる。値は増えるだけのものとして、項目ごとに大きいほうを取るなど、どの順で合わせても同じ結果にする。
   * 変更を当てる直前に保存先の値と合わせ、別のタブが保存した値を消さないために使う。
   * 省略すると、別のタブの値は取り込まず、このタブの値で上書きする（`storage` イベントも見ない）
   */
  merge?(a: T, b: T): T;
  same(a: T, b: T): boolean;
  /** 保存する中身。版（v）は書き足すので含めない */
  serialize(value: T): Record<string, unknown>;
};

/** localStorage に版つきで保存する値。React からは useSyncExternalStore で読む */
export interface PersistentStore<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
  /**
   * change を当てて保存する。merge があれば、手元の値を保存先の値と合わせてから当てる
   * （別のタブの保存をまだ取り込んでいなくても、その値に積み上げる）。変わらなければ知らせない
   */
  update(change: (current: T) => T): void;
  /** `storage` イベントの監視をやめる */
  dispose(): void;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 版つきで localStorage に保存する値（ゲームの記録や設定など）。
 * - 保存先が使えない、壊れている、容量が一杯でも、そのタブの中では値を使い続ける
 * - 保存先に新しい版の内容があれば書き込まない。新しい版を配信したあとも古いページを開いたままのタブが、
 *   新しい版で保存した記録を消さないように。そのタブの中では値を使い続ける
 * - merge があれば、変更を当てる直前に保存先の値と合わせ、別のタブが保存した値を上書きで消さない。
 *   別のタブが保存したら `storage` イベントで取り込む
 */
export function createPersistentStore<T>(opts: PersistentOptions<T>): PersistentStore<T> {
  const { key, version, storage, merge } = opts;
  const events = merge ? (opts.events ?? null) : null;
  const listeners = new Set<() => void>();

  /** 保存された JSON を読む。ない、読めない、壊れているときは undefined */
  const load = (): unknown => {
    try {
      const text = storage?.getItem(key) ?? null;
      return text === null ? undefined : (JSON.parse(text) as unknown);
    } catch {
      return undefined;
    }
  };

  /** 読んだ内容を値にする。この版の内容でなければ空の値 */
  const decode = (saved: unknown): T => (isObject(saved) && saved.v === version ? opts.sanitize(saved) : opts.empty());

  /** 読んだ内容が、この版より新しい版のものか */
  const isNewer = (saved: unknown): boolean => isObject(saved) && typeof saved.v === 'number' && saved.v > version;

  const read = (): T => decode(load());

  let value = read();

  const set = (next: T): void => {
    if (opts.same(value, next)) return;
    value = next;
    for (const l of listeners) l();
  };

  const onStorage = (e: { readonly key: string | null }): void => {
    // key が null なのは clear() のとき。値は増えるだけなので、手元の値は残す
    if (!merge || (e.key !== key && e.key !== null)) return;
    set(merge(value, read()));
  };
  events?.addEventListener('storage', onStorage);

  return {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    update: (change) => {
      const saved = load();
      const next = change(merge ? merge(value, decode(saved)) : value);
      if (storage && !isNewer(saved)) {
        try {
          storage.setItem(key, JSON.stringify({ v: version, ...opts.serialize(next) }));
        } catch {
          // 保存できなくても、このタブの中では値を使い続ける
        }
      }
      set(next);
    },
    dispose: () => events?.removeEventListener('storage', onStorage),
  };
}
