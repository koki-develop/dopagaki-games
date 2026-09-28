import { safeLocalStorage } from '../../juice/storage.ts';
import type { StorageLike } from '../../juice/storage.ts';
import { STAGES } from './stages/stages.ts';
import type { RunMode, RunResult } from './types.ts';

export type Records = {
  bestEndless: number;
  /** ステージ id ごとのベストスコア。遊んだことのないステージは 0 */
  bestStage: Readonly<Record<string, number>>;
  /** クリア済みのステージ数（先頭から連続して） */
  stagesCleared: number;
};

export const RECORDS_KEY = 'dopagaki:breakout:records';
/**
 * 保存する形式の版。形式を変えるときは上げて、読み込みで前の版から移す。
 * 版 1 は別のステージ構成でのクリア数を持つので、移さずに捨てる。
 */
const VERSION = 2;

type Envelope = { v: typeof VERSION; bestEndless: number; bestStage: Record<string, number>; stagesCleared: number };

export function emptyRecords(stageIds: readonly string[]): Records {
  return { bestEndless: 0, bestStage: Object.fromEntries(stageIds.map((id) => [id, 0])), stagesCleared: 0 };
}

/** 0 以上の安全な整数だけを受け付ける。負数・NaN・非数・桁あふれした値は 0 として扱う */
const score = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(Math.floor(v)) && v >= 0 ? Math.floor(v) : 0);

const clampCleared = (v: unknown, stageCount: number): number => Math.min(stageCount, score(v));

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 保存された記録を検証して取り込む。壊れた値や知らないステージは捨てる */
export function sanitizeRecords(raw: unknown, stageIds: readonly string[]): Records {
  const r = emptyRecords(stageIds);
  if (!isObject(raw)) return r;
  const best: Record<string, number> = { ...r.bestStage };
  if (isObject(raw.bestStage)) {
    const src = raw.bestStage;
    for (const id of stageIds) if (Object.hasOwn(src, id)) best[id] = score(src[id]);
  }
  return { bestEndless: score(raw.bestEndless), bestStage: best, stagesCleared: clampCleared(raw.stagesCleared, stageIds.length) };
}

/** 2 つの記録を項目ごとの大きいほうで合わせる。記録は増えるだけなので、どの順で合わせても同じ結果になる */
export function mergeRecords(a: Records, b: Records, stageIds: readonly string[]): Records {
  const best: Record<string, number> = {};
  for (const id of stageIds) best[id] = Math.max(a.bestStage[id] ?? 0, b.bestStage[id] ?? 0);
  return {
    bestEndless: Math.max(a.bestEndless, b.bestEndless),
    bestStage: best,
    stagesCleared: Math.min(stageIds.length, Math.max(a.stagesCleared, b.stagesCleared)),
  };
}

function sameRecords(a: Records, b: Records, stageIds: readonly string[]): boolean {
  return (
    a.bestEndless === b.bestEndless && a.stagesCleared === b.stagesCleared && stageIds.every((id) => (a.bestStage[id] ?? 0) === (b.bestStage[id] ?? 0))
  );
}

/** プレイの結果を記録に反映する。ステージは、クリア済みの次（最前線）をクリアしたときだけ先へ進む */
export function applyResult(r: Records, result: Pick<RunResult, 'mode' | 'cleared' | 'score'>, stageIds: readonly string[]): Records {
  const s = score(result.score);
  if (result.mode.kind === 'endless') return { ...r, bestEndless: Math.max(r.bestEndless, s) };
  const i = result.mode.index;
  const id = stageIds[i];
  if (id === undefined) return r;
  const bestStage = { ...r.bestStage, [id]: Math.max(r.bestStage[id] ?? 0, s) };
  const stagesCleared = result.cleared && i === r.stagesCleared ? Math.min(stageIds.length, i + 1) : r.stagesCleared;
  return { ...r, bestStage, stagesCleared };
}

/** 選べるステージの数: クリア済みのステージと、その次のステージ */
export const selectableStages = (r: Records, stageCount: number): number => Math.min(stageCount, r.stagesCleared + 1);

export function bestFor(r: Records, mode: RunMode, stageIds: readonly string[]): number {
  if (mode.kind === 'endless') return r.bestEndless;
  const id = stageIds[mode.index];
  return id === undefined ? 0 : (r.bestStage[id] ?? 0);
}

/** ブロック崩しの記録。React からは useSyncExternalStore で読み、プレイの結果は commit() で書く */
export interface RecordsStore {
  readonly stageCount: number;
  get(): Records;
  subscribe(listener: () => void): () => void;
  bestFor(mode: RunMode): number;
  selectableStages(): number;
  /** 結果を反映して保存する。保存の直前に保存先の値と合わせるので、別のタブの記録を消さない */
  commit(result: RunResult): void;
  dispose(): void;
}

/** `storage` イベントの届け先。ブラウザでは window */
export type StorageEventSource = {
  addEventListener(type: 'storage', listener: (e: { readonly key: string | null }) => void): void;
  removeEventListener(type: 'storage', listener: (e: { readonly key: string | null }) => void): void;
};

type RecordsStoreOptions = {
  storage: StorageLike | null;
  stageIds: readonly string[];
  /** 別のタブでの保存を知るための `storage` イベントの発生元 */
  events?: StorageEventSource | null;
};

export function createRecordsStore({ storage, stageIds, events = null }: RecordsStoreOptions): RecordsStore {
  const listeners = new Set<() => void>();

  /** 保存された JSON を読む。ない、読めない、壊れているときは undefined */
  const load = (): unknown => {
    try {
      const text = storage?.getItem(RECORDS_KEY) ?? null;
      return text === null ? undefined : (JSON.parse(text) as unknown);
    } catch {
      return undefined;
    }
  };

  const read = (): Records => {
    const saved = load();
    return isObject(saved) && saved.v === VERSION ? sanitizeRecords(saved, stageIds) : emptyRecords(stageIds);
  };

  let value = read();

  const set = (next: Records): void => {
    if (sameRecords(value, next, stageIds)) return;
    value = next;
    for (const l of listeners) l();
  };

  const onStorage = (e: { readonly key: string | null }): void => {
    // key が null なのは clear() のとき。記録は増えるだけなので、手元の値は残す
    if (e.key !== RECORDS_KEY && e.key !== null) return;
    set(mergeRecords(value, read(), stageIds));
  };
  events?.addEventListener('storage', onStorage);

  return {
    stageCount: stageIds.length,
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    bestFor: (mode) => bestFor(value, mode, stageIds),
    selectableStages: () => selectableStages(value, stageIds.length),
    commit: (result) => {
      const next = mergeRecords(applyResult(value, result, stageIds), read(), stageIds);
      if (storage) {
        const env: Envelope = { v: VERSION, bestEndless: next.bestEndless, bestStage: { ...next.bestStage }, stagesCleared: next.stagesCleared };
        try {
          storage.setItem(RECORDS_KEY, JSON.stringify(env));
        } catch {
          // 保存できなくても、このタブの中では記録を使い続ける
        }
      }
      set(next);
    },
    dispose: () => events?.removeEventListener('storage', onStorage),
  };
}

let shared: RecordsStore | null = null;

/** このページで共有するブロック崩しの記録 */
export function breakoutRecords(): RecordsStore {
  shared ??= createRecordsStore({
    storage: safeLocalStorage(),
    stageIds: STAGES.map((s) => s.id),
    events: typeof window !== 'undefined' ? window : null,
  });
  return shared;
}
