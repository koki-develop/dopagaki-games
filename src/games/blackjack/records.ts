import { createPersistentStore } from '../../juice/persistent.ts';
import { safeLocalStorage, windowEvents } from '../../juice/storage.ts';
import type { StorageEventSource, StorageLike } from '../../juice/storage.ts';
import { applyResult, emptyRecords, mergeRecords, sameRecords, sanitizeRecords } from './records-model.ts';
import type { Records, RecordsStore } from './records-model.ts';

export const RECORDS_KEY = 'dopagaki:blackjack:records';
/** 保存する形式の版。形式を変えるときは上げる。版の違う保存内容は捨てる */
const VERSION = 2;

type StoreOptions = {
  storage: StorageLike | null;
  /** 別のタブでの保存を知るための `storage` イベントの発生元 */
  events?: StorageEventSource | null;
};

/** 記録を保存先へつなぐ。値の検証と合成は records-model.ts */
export function createRecordsStore({ storage, events = null }: StoreOptions): RecordsStore {
  const store = createPersistentStore<Records>({
    key: RECORDS_KEY,
    version: VERSION,
    storage,
    events,
    empty: emptyRecords,
    sanitize: sanitizeRecords,
    merge: mergeRecords,
    same: sameRecords,
    serialize: (r) => ({ ...r }),
  });
  return {
    get: store.get,
    subscribe: store.subscribe,
    commit: (result) => store.update((r) => applyResult(r, result)),
    dispose: store.dispose,
  };
}

let sharedRecords: RecordsStore | null = null;

/** このページで共有するブラックジャックの記録 */
export function blackjackRecords(): RecordsStore {
  sharedRecords ??= createRecordsStore({ storage: safeLocalStorage(), events: windowEvents() });
  return sharedRecords;
}
