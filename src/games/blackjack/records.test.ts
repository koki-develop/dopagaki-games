import { describe, expect, test } from 'bun:test';
import { memoryStorage, sharedTabs } from '../../juice/storage.test-support.ts';
import { applyResult, emptyRecords, lifetimeNet, mergeRecords, sanitizeRecords } from './records-model.ts';
import { createRecordsStore, RECORDS_KEY } from './records.ts';
import { runResult, sheetOf } from './result.test-support.ts';

describe('applyResult', () => {
  test('最後の手持ちが記録より多ければ、最高スコアを更新する', () => {
    let r = applyResult(emptyRecords(), runResult());
    r = applyResult(r, runResult({ outcome: 'broke', score: sheetOf({ lost: 950 }) }));
    expect(r.bestScore).toBe(1650);
  });

  test('始めからの増減を、増やした分と減らした分に分けて積み、累計はその差', () => {
    let r = applyResult(emptyRecords(), runResult());
    expect([r.gained, r.lost, lifetimeNet(r)]).toEqual([650, 0, 650]);
    r = applyResult(r, runResult({ outcome: 'broke', score: sheetOf({ lost: 995 }) }));
    expect([r.gained, r.lost, lifetimeNet(r)]).toEqual([650, 995, -345]);
    r = applyResult(r, runResult({ outcome: 'even', score: sheetOf() }));
    expect([r.gained, r.lost, lifetimeNet(r)]).toEqual([650, 995, -345]);
  });
});

describe('sanitizeRecords', () => {
  test('壊れた値とありえない値は 0 にし、小数は切り捨てる', () => {
    expect(sanitizeRecords({ bestScore: 2500.5, gained: 300.9, lost: 120 })).toEqual({ bestScore: 2500, gained: 300, lost: 120 });
    expect(sanitizeRecords({ bestScore: -3, gained: -1, lost: Number.MAX_VALUE })).toEqual(emptyRecords());
    expect(sanitizeRecords({ bestScore: 'x', gained: null, lost: '5' })).toEqual(emptyRecords());
    expect(sanitizeRecords({})).toEqual(emptyRecords());
  });
});

describe('mergeRecords', () => {
  test('項目ごとに大きいほうを取り、どの順でも同じ', () => {
    const a = { bestScore: 3000, gained: 500, lost: 900 };
    const b = { bestScore: 1200, gained: 800, lost: 100 };
    expect(mergeRecords(a, b)).toEqual({ bestScore: 3000, gained: 800, lost: 900 });
    expect(mergeRecords(b, a)).toEqual(mergeRecords(a, b));
  });
});

describe('createRecordsStore', () => {
  test('版つきで保存し、読み直すと同じ値になる', () => {
    const storage = memoryStorage();
    const s = createRecordsStore({ storage });
    s.commit(runResult());
    s.commit(runResult({ outcome: 'loss', score: sheetOf({ lost: 200 }) }));
    const saved = JSON.parse(storage.mem.get(RECORDS_KEY) ?? 'null');
    expect([saved.v, saved.bestScore, saved.gained, saved.lost]).toEqual([3, 1650, 650, 200]);
    expect(createRecordsStore({ storage }).get()).toEqual(s.get());
  });

  test('前の版の保存内容は捨てる', () => {
    const storage = memoryStorage();
    storage.mem.set(RECORDS_KEY, JSON.stringify({ v: 2, bestScore: 9000 }));
    expect(createRecordsStore({ storage }).get()).toEqual(emptyRecords());
  });

  test('別のタブが保存した最高スコアと累計を消さず、その上に積む', () => {
    const tabs = sharedTabs();
    const a = createRecordsStore(tabs.open());
    const b = createRecordsStore(tabs.open());
    b.dispose();
    a.commit(runResult({ score: sheetOf({ won: 5000 }) }));
    b.commit(runResult({ outcome: 'loss', score: sheetOf({ lost: 200 }) }));
    a.commit(runResult({ outcome: 'broke', score: sheetOf({ lost: 1000 }) }));
    const saved = createRecordsStore({ storage: { getItem: (k) => tabs.mem.get(k) ?? null, setItem: () => {} } }).get();
    expect(saved).toEqual({ bestScore: 6000, gained: 5000, lost: 1200 });
    expect(lifetimeNet(saved)).toBe(3800);
  });
});
