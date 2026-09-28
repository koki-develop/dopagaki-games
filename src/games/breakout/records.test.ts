import { describe, expect, test } from 'bun:test';
import type { StorageLike } from '../../juice/storage.ts';
import {
  applyResult,
  createRecordsStore,
  emptyRecords,
  mergeRecords,
  RECORDS_KEY,
  sanitizeRecords,
  selectableStages,
} from './records.ts';
import type { StorageEventSource } from './records.ts';
import type { RunResult } from './types.ts';

const IDS = ['warmup', 'stripes', 'checker', 'pyramid', 'deluge'] as const;

type Mem = StorageLike & { mem: Map<string, string> };

const memoryStorage = (init: Record<string, string> = {}, mem = new Map(Object.entries(init))): Mem => ({
  mem,
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => {
    mem.set(k, v);
  },
});

/** 同じ保存先を共有する別のタブ。保存すると、ほかのタブへ `storage` イベントを送る */
const tabs = () => {
  const mem = new Map<string, string>();
  const all: { listeners: Set<(e: { key: string | null }) => void> }[] = [];
  const open = () => {
    const self = { listeners: new Set<(e: { key: string | null }) => void>() };
    all.push(self);
    const events: StorageEventSource = {
      addEventListener: (_, l) => void self.listeners.add(l),
      removeEventListener: (_, l) => void self.listeners.delete(l),
    };
    const storage: StorageLike = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => {
        mem.set(k, v);
        for (const t of all) if (t !== self) for (const l of t.listeners) l({ key: k });
      },
    };
    return createRecordsStore({ storage, stageIds: IDS, events });
  };
  return { mem, open };
};

const result = (mode: RunResult['mode'], score: number, cleared = false): RunResult => ({ mode, score, cleared, previousBest: 0, newBest: false });

describe('sanitizeRecords', () => {
  test('壊れた値・型違い・負数・NaN・桁あふれは 0 にする', () => {
    const r = sanitizeRecords(
      { bestEndless: -5, bestStage: { warmup: 'x', stripes: Number.NaN, checker: 1e300, pyramid: 12.7, deluge: Infinity }, stagesCleared: 2.9 },
      IDS,
    );
    expect(r.bestEndless).toBe(0);
    expect(r.bestStage).toEqual({ warmup: 0, stripes: 0, checker: 0, pyramid: 12, deluge: 0 });
    expect(r.stagesCleared).toBe(2);
  });

  test('知らないステージは捨て、足りないステージは 0 で埋める', () => {
    const r = sanitizeRecords({ bestEndless: 10, bestStage: { warmup: 5, bonus: 99 }, stagesCleared: 1 }, IDS);
    expect(r.bestStage).toEqual({ warmup: 5, stripes: 0, checker: 0, pyramid: 0, deluge: 0 });
  });

  test('クリア数はステージ数を超えない', () => {
    expect(sanitizeRecords({ stagesCleared: 99 }, IDS).stagesCleared).toBe(IDS.length);
  });

  test('オブジェクトでない値は空の記録', () => {
    for (const raw of [null, 3, 'x', [1, 2], undefined]) expect(sanitizeRecords(raw, IDS)).toEqual(emptyRecords(IDS));
  });
});

describe('applyResult', () => {
  test('ベストは大きいときだけ更新する', () => {
    let r = applyResult(emptyRecords(IDS), result({ kind: 'endless' }, 500), IDS);
    r = applyResult(r, result({ kind: 'endless' }, 300), IDS);
    expect(r.bestEndless).toBe(500);
    r = applyResult(r, result({ kind: 'stage', index: 0 }, 40), IDS);
    r = applyResult(r, result({ kind: 'stage', index: 0 }, 20), IDS);
    expect(r.bestStage.warmup).toBe(40);
  });

  test('クリア数が進むのは、最前線のステージをクリアしたときだけ', () => {
    let r = emptyRecords(IDS);
    r = applyResult(r, result({ kind: 'stage', index: 0 }, 10, false), IDS);
    expect(r.stagesCleared).toBe(0);
    r = applyResult(r, result({ kind: 'stage', index: 0 }, 10, true), IDS);
    expect(r.stagesCleared).toBe(1);
    r = applyResult(r, result({ kind: 'stage', index: 0 }, 10, true), IDS);
    expect(r.stagesCleared).toBe(1);
    r = applyResult(r, result({ kind: 'stage', index: 3 }, 10, true), IDS);
    expect(r.stagesCleared).toBe(1);
    r = applyResult(r, result({ kind: 'stage', index: 1 }, 10, true), IDS);
    expect(r.stagesCleared).toBe(2);
  });

  test('範囲外のステージは無視する', () => {
    const r = emptyRecords(IDS);
    expect(applyResult(r, result({ kind: 'stage', index: 9 }, 10, true), IDS)).toBe(r);
  });

  test('選べるステージは、クリア済みとその次', () => {
    expect(selectableStages(emptyRecords(IDS), IDS.length)).toBe(1);
    expect(selectableStages({ ...emptyRecords(IDS), stagesCleared: 5 }, IDS.length)).toBe(5);
  });
});

describe('mergeRecords', () => {
  test('項目ごとの大きいほうを取る', () => {
    const a = { bestEndless: 10, bestStage: { ...emptyRecords(IDS).bestStage, warmup: 5 }, stagesCleared: 2 };
    const b = { bestEndless: 3, bestStage: { ...emptyRecords(IDS).bestStage, warmup: 1, pyramid: 9 }, stagesCleared: 1 };
    expect(mergeRecords(a, b, IDS)).toEqual({ bestEndless: 10, bestStage: { warmup: 5, stripes: 0, checker: 0, pyramid: 9, deluge: 0 }, stagesCleared: 2 });
  });
});

describe('createRecordsStore', () => {
  test('壊れた JSON は空の記録として読む', () => {
    const s = createRecordsStore({ storage: memoryStorage({ [RECORDS_KEY]: '{not json' }), stageIds: IDS });
    expect(s.get()).toEqual(emptyRecords(IDS));
  });

  test('版 1 の記録は読まない', () => {
    const storage = memoryStorage({ [RECORDS_KEY]: JSON.stringify({ v: 1, bestEndless: 42, bestStage: { warmup: 10 }, stagesCleared: 3 }) });
    expect(createRecordsStore({ storage, stageIds: IDS }).get()).toEqual(emptyRecords(IDS));
  });

  test('保存先がなくても使える', () => {
    const s = createRecordsStore({ storage: null, stageIds: IDS });
    s.commit(result({ kind: 'endless' }, 50));
    expect(s.get().bestEndless).toBe(50);
  });

  test('保存は版つきの形式で、読み直すと同じ値になる', () => {
    const storage = memoryStorage();
    const a = createRecordsStore({ storage, stageIds: IDS });
    a.commit(result({ kind: 'stage', index: 0 }, 80, true));
    expect(JSON.parse(storage.mem.get(RECORDS_KEY) ?? 'null')).toEqual({
      v: 2,
      bestEndless: 0,
      bestStage: { warmup: 80, stripes: 0, checker: 0, pyramid: 0, deluge: 0 },
      stagesCleared: 1,
    });
    expect(createRecordsStore({ storage, stageIds: IDS }).get()).toEqual(a.get());
  });

  test('容量が一杯でも、保存済みの記録は読める', () => {
    const base = memoryStorage({ [RECORDS_KEY]: JSON.stringify({ v: 2, bestEndless: 42, bestStage: {}, stagesCleared: 0 }) });
    const full: StorageLike = {
      getItem: base.getItem,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const s = createRecordsStore({ storage: full, stageIds: IDS });
    expect(s.get().bestEndless).toBe(42);
    expect(() => s.commit(result({ kind: 'endless' }, 100))).not.toThrow();
    expect(s.get().bestEndless).toBe(100);
  });

  test('別のタブの記録を上書きで消さず、`storage` イベントで取り込む', () => {
    const { mem, open } = tabs();
    const a = open();
    const b = open();
    let notified = 0;
    b.subscribe(() => notified++);

    a.commit(result({ kind: 'stage', index: 0 }, 100, true));
    expect(notified).toBe(1);
    expect(b.get().bestStage.warmup).toBe(100);
    expect(b.get().stagesCleared).toBe(1);

    // b の手元の値が古くても、保存の直前に保存先と合わせる
    b.dispose();
    a.commit(result({ kind: 'endless' }, 900));
    b.commit(result({ kind: 'stage', index: 1 }, 50, true));
    const saved = createRecordsStore({ storage: { getItem: (k) => mem.get(k) ?? null, setItem: () => {} }, stageIds: IDS }).get();
    expect(saved.bestEndless).toBe(900);
    expect(saved.bestStage.warmup).toBe(100);
    expect(saved.bestStage.stripes).toBe(50);
    expect(saved.stagesCleared).toBe(2);
  });

  test('値が変わらないときは通知せず、同じオブジェクトを返す', () => {
    const s = createRecordsStore({ storage: memoryStorage(), stageIds: IDS });
    s.commit(result({ kind: 'endless' }, 10));
    const before = s.get();
    let notified = 0;
    s.subscribe(() => notified++);
    s.commit(result({ kind: 'endless' }, 5));
    expect(notified).toBe(0);
    expect(s.get()).toBe(before);
  });
});
