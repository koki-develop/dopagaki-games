import type { StorageEventSource } from './storage.ts';
import type { StorageLike } from './storage.ts';

/** 中身を Map に持つ保存先 */
type MemoryStorage = StorageLike & { mem: Map<string, string> };

export const memoryStorage = (init: Record<string, string> = {}, mem = new Map(Object.entries(init))): MemoryStorage => ({
  mem,
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => {
    mem.set(k, v);
  },
});

/** 1 つのタブの保存先と `storage` イベントの発生元 */
type Tab = { storage: StorageLike; events: StorageEventSource };

/** 同じ保存先を共有する複数のタブ。あるタブが保存すると、ほかのタブへ `storage` イベントを送る */
export function sharedTabs(): { mem: Map<string, string>; open(): Tab } {
  const mem = new Map<string, string>();
  const all: { listeners: Set<(e: { key: string | null }) => void> }[] = [];
  const open = (): Tab => {
    const self = { listeners: new Set<(e: { key: string | null }) => void>() };
    all.push(self);
    return {
      events: {
        addEventListener: (_, l) => void self.listeners.add(l),
        removeEventListener: (_, l) => void self.listeners.delete(l),
      },
      storage: {
        getItem: (k) => mem.get(k) ?? null,
        setItem: (k, v) => {
          mem.set(k, v);
          for (const t of all) if (t !== self) for (const l of t.listeners) l({ key: k });
        },
      },
    };
  };
  return { mem, open };
}
