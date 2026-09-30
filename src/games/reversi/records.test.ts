import { describe, expect, test } from 'bun:test';
import { memoryStorage, sharedTabs } from '../../juice/storage.test-support.ts';
import { createPrefsStore, createRecordsStore, PREFS_KEY, RECORDS_KEY } from './records.ts';
import { BLACK, WHITE } from './rules/position.ts';
import { runResult, sheetOf } from './result.test-support.ts';

describe('createRecordsStore', () => {
  test('版つきで保存し、読み直すと同じ値になる', () => {
    const storage = memoryStorage();
    const s = createRecordsStore({ storage });
    s.commit(runResult());
    const saved = JSON.parse(storage.mem.get(RECORDS_KEY) ?? 'null');
    expect([saved.v, saved.wins]).toEqual([1, 1]);
    expect(createRecordsStore({ storage }).get()).toEqual(s.get());
  });

  test('別のタブが保存した最高スコアを消さない', () => {
    const tabs = sharedTabs();
    const a = createRecordsStore(tabs.open());
    const b = createRecordsStore(tabs.open());
    b.dispose();
    a.commit(runResult({ score: sheetOf({ moves: 50_000, discs: 40, won: true, perfect: false, maxCombo: 6 }) }));
    b.commit(runResult({ outcome: 'lose', score: sheetOf({ moves: 10, discs: 10, won: false, perfect: false, maxCombo: 0 }) }));
    const saved = createRecordsStore({ storage: { getItem: (k) => tabs.mem.get(k) ?? null, setItem: () => {} } }).get();
    expect(saved.bestScore).toBe(sheetOf({ moves: 50_000, discs: 40, won: true, perfect: false, maxCombo: 6 }).total);
    expect(saved.losses).toBe(1);
  });
});

describe('createPrefsStore', () => {
  test('最後に選んだ色を覚え、壊れた値は既定値にする', () => {
    const storage = memoryStorage();
    const p = createPrefsStore({ storage });
    expect(p.get()).toEqual({ human: BLACK });
    p.update(() => ({ human: WHITE }));
    expect(createPrefsStore({ storage }).get()).toEqual({ human: WHITE });
    const broken = memoryStorage({ [PREFS_KEY]: JSON.stringify({ v: 1, human: 7 }) });
    expect(createPrefsStore({ storage: broken }).get()).toEqual({ human: BLACK });
  });
});
