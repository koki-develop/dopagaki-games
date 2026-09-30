import { describe, expect, test } from 'bun:test';
import { Rng } from '../../../shared/rng.ts';
import { BlockType, COLS, sanitizeTuning, tuning } from '../config.ts';
import { BlockField } from './blocks.ts';
import { EndlessRows, hardHpAt, hardRatioAt } from './endless-rows.ts';

const e = sanitizeTuning(tuning).endless;

describe('エンドレスの難易度', () => {
  test('ハードの HP は 2 から始まり、時間とともに上がって 24 で止まる', () => {
    expect(hardHpAt(e, 0)).toBe(2);
    expect(hardHpAt(e, 45)).toBe(Math.round(2 * 2 ** 1.7));
    let last = 0;
    for (let t = 0; t <= 3600; t += 5) {
      const hp = hardHpAt(e, t);
      expect(hp).toBeGreaterThanOrEqual(last);
      expect(hp).toBeLessThanOrEqual(24);
      last = hp;
    }
    expect(last).toBe(24);
    expect(hardHpAt(e, 1e9)).toBe(24);
  });

  test('ハードの出現率は 300 秒かけて 0.14 から 0.8 まで上がり、その後は変わらない', () => {
    expect(hardRatioAt(e, 0)).toBeCloseTo(0.14, 12);
    expect(hardRatioAt(e, 150)).toBeCloseTo(0.47, 12);
    expect(hardRatioAt(e, 300)).toBeCloseTo(0.8, 12);
    expect(hardRatioAt(e, 3000)).toBeCloseTo(0.8, 12);
  });
});

describe('ジャックポット', () => {
  /** 1 行ずつ作り、各行の種類と HP を返す。times[i] は i 行目を作るときのプレイ時間 */
  function makeRows(seed: number, times: number[]) {
    const rows = new EndlessRows(e, new Rng(seed));
    const f = new BlockField();
    return times.map((t) => {
      f.clearAll();
      const row = f.pushRowTop();
      rows.fill(f, row, t, 0);
      const base = f.slotOf(row) * COLS;
      return { type: Array.from(f.type.subarray(base, base + COLS)), hp: Array.from(f.hp.subarray(base, base + COLS)) };
    });
  }

  const isJackpotEdge = (r: { type: number[] }) => r.type.every((t) => t === BlockType.Hard);
  const isJackpotBody = (r: { type: number[] }) =>
    r.type[0] === BlockType.Hard &&
    r.type[COLS - 1] === BlockType.Hard &&
    r.type.slice(1, COLS - 1).every((t) => t === BlockType.Mega);

  test('120 秒になると、外周をハードで切れ目なく囲み、中をメガで埋めた 7 行の帯を出す', () => {
    const times = [...Array.from({ length: 30 }, (_, i) => i), ...Array.from({ length: 7 }, () => 120)];
    for (const seed of [1, 2, 3, 4, 5]) {
      const rows = makeRows(seed, times);
      const jackpot = rows.slice(30);
      expect(isJackpotEdge(jackpot[0])).toBe(true);
      for (const r of jackpot.slice(1, 6)) expect(isJackpotBody(r)).toBe(true);
      expect(isJackpotEdge(jackpot[6])).toBe(true);
      const hardHp = hardHpAt(e, 120);
      for (const r of jackpot) {
        for (let col = 0; col < COLS; col++) expect(r.hp[col]).toBe(r.type[col] === BlockType.Hard ? hardHp : 1);
      }
    }
  });

  test('間隔は乱数によらず一定で、1 回に 1 つだけ出す', () => {
    const times = Array.from({ length: 600 }, (_, i) => i);
    for (const seed of [1, 2, 3]) {
      const rows = makeRows(seed, times);
      const starts = rows.flatMap((r, i) => (isJackpotEdge(r) && isJackpotBody(rows[i + 1] ?? r) ? [i] : []));
      expect(starts).toEqual([120, 240, 360, 480]);
    }
  });

  test('ジャックポットの帯を並べている間に次の時刻が来ても、帯を打ち切らない', () => {
    const rows = makeRows(1, [119, 120, 120, 120, 240, 240, 240, 240, 240, 240, 240, 240]);
    expect(isJackpotEdge(rows[1])).toBe(true);
    for (const r of rows.slice(2, 7)) expect(isJackpotBody(r)).toBe(true);
    expect(isJackpotEdge(rows[7])).toBe(true);
    expect(isJackpotEdge(rows[8])).toBe(true);
    expect(isJackpotBody(rows[9])).toBe(true);
  });
});
