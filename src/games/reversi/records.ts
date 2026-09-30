import { createPersistentStore } from '../../juice/persistent.ts';
import type { PersistentStore } from '../../juice/persistent.ts';
import { safeLocalStorage, windowEvents } from '../../juice/storage.ts';
import type { StorageEventSource, StorageLike } from '../../juice/storage.ts';
import { applyResult, emptyRecords, mergeRecords, sameRecords, sanitizeRecords } from './records-model.ts';
import type { Records, RecordsStore } from './records-model.ts';
import { BLACK, WHITE } from './rules/position.ts';
import type { Color } from './rules/position.ts';
import type { MatchSetup } from './types.ts';

export const RECORDS_KEY = 'dopagaki:reversi:records';
/** 保存する形式の版。形式を変えるときは上げる。版の違う保存内容は捨てる */
const VERSION = 1;

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

/** 最後に選んだ対局の設定（次にタイトルを開いたときの初期値） */
export const PREFS_KEY = 'dopagaki:reversi:prefs';
const PREFS_VERSION = 1;
const DEFAULT_SETUP: MatchSetup = { human: BLACK };

function sanitizePrefs(raw: Readonly<Record<string, unknown>>): MatchSetup {
  const human: Color = raw.human === WHITE ? WHITE : BLACK;
  return { human };
}

/** 最後に選んだ対局の設定。別のタブの選択より、このタブの選択を優先する */
export function createPrefsStore({ storage }: { storage: StorageLike | null }): PersistentStore<MatchSetup> {
  return createPersistentStore<MatchSetup>({
    key: PREFS_KEY,
    version: PREFS_VERSION,
    storage,
    empty: () => DEFAULT_SETUP,
    sanitize: sanitizePrefs,
    same: (a, b) => a.human === b.human,
    serialize: (p) => ({ human: p.human }),
  });
}

let sharedRecords: RecordsStore | null = null;
let sharedPrefs: PersistentStore<MatchSetup> | null = null;

/** このページで共有するリバーシの記録 */
export function reversiRecords(): RecordsStore {
  sharedRecords ??= createRecordsStore({ storage: safeLocalStorage(), events: windowEvents() });
  return sharedRecords;
}

/** このページで共有する、最後に選んだ対局の設定 */
export function reversiPrefs(): PersistentStore<MatchSetup> {
  sharedPrefs ??= createPrefsStore({ storage: safeLocalStorage() });
  return sharedPrefs;
}
