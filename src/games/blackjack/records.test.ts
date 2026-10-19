import { describe, expect, test } from 'bun:test';
import { memoryStorage, sharedTabs } from '../../juice/storage.test-support.ts';
import { applyResult, emptyRecords, mergeRecords, sanitizeRecords } from './records-model.ts';
import { createRecordsStore, RECORDS_KEY } from './records.ts';
import { runResult, sheetOf } from './result.test-support.ts';

describe('applyResult', () => {
  test('最後の手持ちが記録より多ければ、最高スコアを更新する', () => {
    let r = applyResult(emptyRecords(), runResult());
    r = applyResult(r, runResult({ outcome: 'broke', score: sheetOf({ lost: 950 }) }));
    expect(r).toEqual({ bestScore: 1650 });
  });
});

describe('sanitizeRecords', () => {
  test('壊れた値とありえない値は 0 にし、小数は切り捨てる', () => {
    expect(sanitizeRecords({ bestScore: 2500.5 })).toEqual({ bestScore: 2500 });
    expect(sanitizeRecords({ bestScore: -3 })).toEqual({ bestScore: 0 });
    expect(sanitizeRecords({ bestScore: 'x' })).toEqual({ bestScore: 0 });
    expect(sanitizeRecords({})).toEqual(emptyRecords());
  });
});

describe('mergeRecords', () => {
  test('大きいほうを取り、どの順でも同じ', () => {
    expect(mergeRecords({ bestScore: 3000 }, { bestScore: 1200 })).toEqual({ bestScore: 3000 });
    expect(mergeRecords({ bestScore: 1200 }, { bestScore: 3000 })).toEqual({ bestScore: 3000 });
  });
});

describe('createRecordsStore', () => {
  test('版つきで保存し、読み直すと同じ値になる', () => {
    const storage = memoryStorage();
    const s = createRecordsStore({ storage });
    s.commit(runResult());
    const saved = JSON.parse(storage.mem.get(RECORDS_KEY) ?? 'null');
    expect([saved.v, saved.bestScore]).toEqual([2, 1650]);
    expect(createRecordsStore({ storage }).get()).toEqual(s.get());
  });

  test('前の版の保存内容は捨てる', () => {
    const storage = memoryStorage();
    storage.mem.set(RECORDS_KEY, JSON.stringify({ v: 1, bestScore: 9000, played: 3 }));
    expect(createRecordsStore({ storage }).get()).toEqual(emptyRecords());
  });

  test('別のタブが保存した最高スコアを消さない', () => {
    const tabs = sharedTabs();
    const a = createRecordsStore(tabs.open());
    const b = createRecordsStore(tabs.open());
    b.dispose();
    a.commit(runResult({ score: sheetOf({ won: 5000 }) }));
    b.commit(runResult({ outcome: 'loss', score: sheetOf({ lost: 200 }) }));
    const saved = createRecordsStore({ storage: { getItem: (k) => tabs.mem.get(k) ?? null, setItem: () => {} } }).get();
    expect(saved.bestScore).toBe(6000);
  });
});
