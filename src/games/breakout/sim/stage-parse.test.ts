import { describe, expect, test } from 'bun:test';
import { BlockType, COLS } from '../config.ts';
import { STAGE_MAX_ROWS, StageParseError, parseStage, stageHardHp } from './stage-parse.ts';

const row = (s: string) => s + '.'.repeat(COLS - s.length);

describe('stageHardHp', () => {
  test('数字は HP、記号は 12 / 20 / 30、それ以外はハードではない', () => {
    for (let d = 2; d <= 9; d++) expect(stageHardHp(String(d))).toBe(d);
    expect(stageHardHp('#')).toBe(12);
    expect(stageHardHp('%')).toBe(20);
    expect(stageHardHp('@')).toBe(30);
    for (const ch of ['0', '1', 'o', 'M', '.', '', '22', 'x']) expect(stageHardHp(ch)).toBe(0);
  });
});

describe('parseStage', () => {
  test('文字をセルの種類と HP に展開する', () => {
    const p = parseStage({ id: 'demo', name: 'DEMO', rows: [row('o3M'), row('.@')] });
    expect(p.rowCount).toBe(2);
    expect(p.liveCount).toBe(4);
    expect(Array.from(p.type.subarray(0, 3))).toEqual([BlockType.Ball, BlockType.Hard, BlockType.Mega]);
    expect(Array.from(p.hp.subarray(0, 3))).toEqual([1, 3, 1]);
    expect(p.type[COLS]).toBe(BlockType.Empty);
    expect(p.type[COLS + 1]).toBe(BlockType.Hard);
    expect(p.hp[COLS + 1]).toBe(30);
  });

  test('配置の誤りは、ステージと位置を示すエラーになる', () => {
    const bad = (rows: string[], id = 'bad') => () => parseStage({ id, name: 'BAD', rows });
    expect(bad(['o'.repeat(COLS + 1)])).toThrow(StageParseError);
    expect(bad(['o'.repeat(COLS + 1)])).toThrow('stage "bad": row 1 has 13 columns; expected 12');
    expect(bad([row('o'), row('ox')])).toThrow('row 2 column 2 has unknown symbol "x"');
    expect(bad([row('1')])).toThrow('unknown symbol "1"');
    expect(bad([])).toThrow('has no rows');
    expect(bad([row('')])).toThrow('has no blocks');
    expect(bad(Array.from({ length: STAGE_MAX_ROWS + 1 }, () => row('o')))).toThrow(`at most ${STAGE_MAX_ROWS} fit`);
    expect(bad([row('o')], 'Upper')).toThrow('id must be lowercase');
    expect(() => parseStage({ id: 'ok', name: 'OK', rows: Array.from({ length: STAGE_MAX_ROWS }, () => row('o')) })).not.toThrow();
  });
});
