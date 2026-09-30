import { createPersistentStore } from '../../juice/persistent.ts';
import { safeLocalStorage, windowEvents } from '../../juice/storage.ts';
import type { StorageEventSource, StorageLike } from '../../juice/storage.ts';
import { applyResult, bestFor, emptyRecords, mergeRecords, sameRecords, sanitizeRecords, selectableStages } from './records-model.ts';
import type { Records, RecordsStore } from './records-model.ts';
import { STAGES } from './stages/stages.ts';

export const RECORDS_KEY = 'dopagaki:breakout:records';
/** 保存する形式の版。形式を変えるときは上げる。版の違う保存内容は捨てる */
const VERSION = 2;

type Envelope = { v: typeof VERSION; bestEndless: number; bestStage: Record<string, number>; stagesCleared: number };

type RecordsStoreOptions = {
  storage: StorageLike | null;
  stageIds: readonly string[];
  /** 別のタブでの保存を知るための `storage` イベントの発生元 */
  events?: StorageEventSource | null;
};

/** 記録を保存先へつなぐ。値の検証と合成は records-model.ts */
export function createRecordsStore({ storage, stageIds, events = null }: RecordsStoreOptions): RecordsStore {
  const store = createPersistentStore<Records>({
    key: RECORDS_KEY,
    version: VERSION,
    storage,
    events,
    empty: () => emptyRecords(stageIds),
    sanitize: (saved) => sanitizeRecords(saved, stageIds),
    merge: (a, b) => mergeRecords(a, b, stageIds),
    same: (a, b) => sameRecords(a, b, stageIds),
    serialize: (r): Omit<Envelope, 'v'> => ({ bestEndless: r.bestEndless, bestStage: { ...r.bestStage }, stagesCleared: r.stagesCleared }),
  });

  return {
    stageCount: stageIds.length,
    get: store.get,
    subscribe: store.subscribe,
    bestFor: (mode) => bestFor(store.get(), mode, stageIds),
    selectableStages: () => selectableStages(store.get(), stageIds.length),
    commit: (result) => store.update((r) => applyResult(r, result, stageIds)),
    dispose: store.dispose,
  };
}

let shared: RecordsStore | null = null;

/** このページで共有するブロック崩しの記録 */
export function breakoutRecords(): RecordsStore {
  shared ??= createRecordsStore({
    storage: safeLocalStorage(),
    stageIds: STAGES.map((s) => s.id),
    events: windowEvents(),
  });
  return shared;
}
