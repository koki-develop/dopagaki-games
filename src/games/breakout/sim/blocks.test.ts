import { describe, expect, test } from 'bun:test';
import { BlockType, CELL_H, COLS } from '../config.ts';
import { BlockField, ROW_CAPACITY, ROW_EPS, SIM_LONG_AGO } from './blocks.ts';

/** 行を n 行積み、各行の列 0 にボール入りを置く */
function filled(n: number, lowestRowY = 0): BlockField {
  const f = new BlockField();
  f.placeAt(lowestRowY);
  for (let i = 0; i < n; i++) f.setCell(f.pushRowTop(), 0, BlockType.Ball, 1, 0);
  return f;
}

function sumRowLive(f: BlockField): number {
  let n = 0;
  for (let row = 0; row < f.rowCount; row++) n += f.rowLive[f.slotOf(row)];
  return n;
}

describe('BlockField', () => {
  test('リングバッファの端をまたいでも、行の番号と中身は保たれる', () => {
    const f = filled(ROW_CAPACITY - 4);
    for (let row = 0; row < 10; row++) f.removeAt(f.slotOf(row) * COLS);
    f.pruneEmptyBottomRows();
    expect(f.bottomSlot).toBe(10);
    expect(f.rowCount).toBe(ROW_CAPACITY - 14);
    expect(f.lowestRowY).toBeCloseTo(10 * CELL_H, 9);
    for (let i = 0; i < 12; i++) {
      const row = f.pushRowTop();
      f.setCell(row, 5, BlockType.Hard, 7, 0);
    }
    // 端をまたいだ行は、配列の先頭の枠に入る
    expect(f.slotOf(f.rowCount - 1)).toBeLessThan(f.bottomSlot);
    const top = f.slotOf(f.rowCount - 1) * COLS + 5;
    expect(f.type[top]).toBe(BlockType.Hard);
    expect(f.hp[top]).toBe(7);
    expect(f.liveCount).toBe(ROW_CAPACITY - 14 + 12);
    expect(sumRowLive(f)).toBe(f.liveCount);
  });

  test('容量いっぱいで行を足そうとするとエラーになる', () => {
    const f = filled(ROW_CAPACITY);
    expect(() => f.pushRowTop()).toThrow(/row capacity/);
  });

  test('空でないセルを上書きしても、生存数は二重に数えない', () => {
    const f = filled(1);
    f.setCell(0, 0, BlockType.Hard, 3, 0);
    expect(f.liveCount).toBe(1);
    f.setCell(0, 0, BlockType.Empty, 0, 0);
    expect(f.liveCount).toBe(0);
    expect(f.rowLive[f.slotOf(0)]).toBe(0);
    f.setCell(0, 1, BlockType.Mega, 1, 0);
    f.setCell(0, 1, BlockType.Ball, 1, 0);
    expect(f.liveCount).toBe(1);
  });

  test('HP が Uint8 に収まらないセルは作らない', () => {
    const f = filled(1);
    expect(() => f.setCell(0, 2, BlockType.Hard, 256, 0)).toThrow(/does not fit/);
    expect(() => f.setCell(0, 2, BlockType.Hard, 255, 0)).not.toThrow();
  });

  test('空のセルを消しても何も変わらない', () => {
    const f = filled(2);
    const v = f.version;
    f.removeAt(f.slotOf(0) * COLS + 3);
    expect(f.liveCount).toBe(2);
    expect(f.version).toBe(v);
  });

  test('ハードは当たるたびに HP が減り、0 で消える', () => {
    const f = filled(1);
    f.setCell(0, 4, BlockType.Hard, 2, 0);
    const idx = f.slotOf(0) * COLS + 4;
    expect(f.damageAt(idx)).toBe(1);
    expect(f.type[idx]).toBe(BlockType.Hard);
    expect(f.damageAt(idx)).toBe(0);
    expect(f.type[idx]).toBe(BlockType.Empty);
    expect(f.liveCount).toBe(1);
  });

  test('liveCountBelow は、下端が y ちょうど（誤差 ROW_EPS 以内）の行を含めない', () => {
    const f = filled(3, 1);
    const y = f.rowBottomY(2);
    expect(f.liveCountBelow(y)).toBe(2);
    expect(f.liveCountBelow(y + ROW_EPS * 0.5)).toBe(2);
    expect(f.liveCountBelow(y - ROW_EPS * 0.5)).toBe(2);
    expect(f.liveCountBelow(y + ROW_EPS * 2)).toBe(3);
    expect(f.liveCountBelow(y - ROW_EPS * 2)).toBe(2);
  });

  test('空行を捨てた後は、一番下の行に必ず生きたブロックがある', () => {
    const f = filled(8);
    for (const row of [0, 1, 2, 4]) f.removeAt(f.slotOf(row) * COLS);
    f.pruneEmptyBottomRows();
    expect(f.rowCount).toBe(5);
    expect(f.rowLive[f.bottomSlot]).toBeGreaterThan(0);
    expect(sumRowLive(f)).toBe(f.liveCount);
    expect(f.lowestLiveBlockBottom()).toBeCloseTo(f.rowBottomY(0) + (CELL_H - (CELL_H - 0.05)) / 2, 9);
    for (let row = 0; row < f.rowCount; row++) f.removeAt(f.slotOf(row) * COLS);
    f.pruneEmptyBottomRows();
    expect(f.rowCount).toBe(0);
    expect(f.lowestLiveBlockBottom()).toBe(Infinity);
  });

  test('placeAt は空の格子にだけ使える', () => {
    const f = filled(1);
    expect(() => f.placeAt(3)).toThrow(/empty field/);
    f.clearAll();
    f.placeAt(3);
    expect(f.lowestRowY).toBe(3);
  });

  test('まだ当たっていないセルの当たった時刻と、置いていないセルの出現時刻は SIM_LONG_AGO', () => {
    expect(Math.fround(SIM_LONG_AGO)).toBe(SIM_LONG_AGO);
    const f = filled(2);
    const row = f.pushRowTop();
    const base = f.slotOf(row) * COLS;
    expect(f.hitAt[base]).toBe(SIM_LONG_AGO);
    expect(f.bornAt[base]).toBe(SIM_LONG_AGO);
    f.setCell(row, 0, BlockType.Hard, 3, 2);
    f.markHit(base, 5);
    expect(f.hitAt[base]).toBe(5);
    // 置き直したセルは、まだ当たっていないことになる
    f.setCell(row, 0, BlockType.Ball, 1, 6);
    expect(f.hitAt[base]).toBe(SIM_LONG_AGO);
    expect(f.bornAt[base]).toBe(6);
  });
});
