import { describe, expect, test } from 'bun:test';
import { createPersistentStore } from './persistent.ts';
import type { StorageEventSource, StorageLike } from './storage.ts';
import { memoryStorage, sharedTabs } from './storage.test-support.ts';

/** 値は増えるだけの 2 つの数 */
type Pair = { a: number; b: number };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

const open = (storage: StorageLike | null, events: StorageEventSource | null = null) =>
  createPersistentStore<Pair>({
    key: 'k',
    version: 2,
    storage,
    events,
    empty: () => ({ a: 0, b: 0 }),
    sanitize: (s) => ({ a: num(s.a), b: num(s.b) }),
    merge: (x, y) => ({ a: Math.max(x.a, y.a), b: Math.max(x.b, y.b) }),
    same: (x, y) => x.a === y.a && x.b === y.b,
    serialize: (p) => ({ a: p.a, b: p.b }),
  });

describe('createPersistentStore', () => {
  test('版つきで保存し、読み直すと同じ値になる', () => {
    const storage = memoryStorage();
    open(storage).update((p) => ({ ...p, a: 3 }));
    expect(JSON.parse(storage.mem.get('k') ?? 'null')).toEqual({ v: 2, a: 3, b: 0 });
    expect(open(storage).get()).toEqual({ a: 3, b: 0 });
  });

  test('壊れた JSON、オブジェクトでない値、ほかの版は空の値として読む', () => {
    expect(open(memoryStorage({ k: '{oops' })).get()).toEqual({ a: 0, b: 0 });
    expect(open(memoryStorage({ k: '[1,2]' })).get()).toEqual({ a: 0, b: 0 });
    expect(open(memoryStorage({ k: JSON.stringify({ v: 1, total: 9 }) })).get()).toEqual({ a: 0, b: 0 });
  });

  test('古い版の保存内容は上書きし、新しい版の保存内容は上書きしない', () => {
    const older = memoryStorage({ k: JSON.stringify({ v: 1, total: 9 }) });
    open(older).update((p) => ({ ...p, a: 1 }));
    expect(JSON.parse(older.mem.get('k') ?? 'null')).toEqual({ v: 2, a: 1, b: 0 });

    // 新しい版のコードが保存した内容を、古い版のまま開いているタブが消さない
    const saved = JSON.stringify({ v: 3, a: 7, extra: true });
    const newer = memoryStorage({ k: saved });
    const s = open(newer);
    s.update((p) => ({ ...p, a: 2 }));
    expect(newer.mem.get('k')).toBe(saved);
    expect(s.get()).toEqual({ a: 2, b: 0 });
  });

  test('保存先がない、または保存に失敗しても、手元の値は変わる', () => {
    const none = open(null);
    none.update((p) => ({ ...p, b: 4 }));
    expect(none.get().b).toBe(4);
    const full = open({
      getItem: () => JSON.stringify({ v: 2, a: 1, b: 0 }),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => full.update((p) => ({ ...p, a: 5 }))).not.toThrow();
    expect(full.get().a).toBe(5);
  });

  test('変わらない更新では知らせず、同じオブジェクトのまま', () => {
    const s = open(memoryStorage());
    s.update((p) => ({ ...p, a: 1 }));
    const before = s.get();
    let notified = 0;
    s.subscribe(() => notified++);
    s.update((p) => ({ ...p }));
    expect(notified).toBe(0);
    expect(s.get()).toBe(before);
  });

  test('別のタブの保存を取り込み、保存の直前に合わせて消さない', () => {
    const tabs = sharedTabs();
    const t1 = tabs.open();
    const t2 = tabs.open();
    const a = open(t1.storage, t1.events);
    const b = open(t2.storage, t2.events);
    let notified = 0;
    b.subscribe(() => notified++);
    a.update((p) => ({ ...p, a: 7 }));
    expect(notified).toBe(1);
    expect(b.get().a).toBe(7);

    b.dispose();
    a.update((p) => ({ ...p, a: 9 }));
    b.update((p) => ({ ...p, b: 2 }));
    expect(JSON.parse(tabs.mem.get('k') ?? 'null')).toEqual({ v: 2, a: 9, b: 2 });
  });

  test('別のタブの保存をまだ取り込んでいなくても、保存先の値に合わせてから変更を当てる（数え上げが消えない）', () => {
    const storage = memoryStorage();
    // storage イベントが届く前に、両方のタブが同じ項目を 1 つ増やす
    const a = open(storage);
    const b = open(storage);
    a.update((p) => ({ ...p, a: p.a + 1 }));
    b.update((p) => ({ ...p, a: p.a + 1 }));
    expect(b.get().a).toBe(2);
    expect(JSON.parse(storage.mem.get('k') ?? 'null')).toEqual({ v: 2, a: 2, b: 0 });
  });

  test('merge が無ければ、別のタブの値を取り込まず、このタブの値で上書きする', () => {
    const tabs = sharedTabs();
    const t1 = tabs.open();
    const t2 = tabs.open();
    let subscribed = 0;
    const events: StorageEventSource = {
      addEventListener: (type, l) => {
        subscribed++;
        t2.events.addEventListener(type, l);
      },
      removeEventListener: (type, l) => t2.events.removeEventListener(type, l),
    };
    const plain = (storage: StorageLike, ev: StorageEventSource) =>
      createPersistentStore<Pair>({
        key: 'k',
        version: 2,
        storage,
        events: ev,
        empty: () => ({ a: 0, b: 0 }),
        sanitize: (s) => ({ a: num(s.a), b: num(s.b) }),
        same: (x, y) => x.a === y.a && x.b === y.b,
        serialize: (p) => ({ a: p.a, b: p.b }),
      });
    const a = plain(t1.storage, t1.events);
    const b = plain(t2.storage, events);
    expect(subscribed).toBe(0);
    a.update((p) => ({ ...p, a: 7 }));
    expect(b.get().a).toBe(0);
    b.update((p) => ({ ...p, b: 2 }));
    expect(JSON.parse(tabs.mem.get('k') ?? 'null')).toEqual({ v: 2, a: 0, b: 2 });
  });
});
