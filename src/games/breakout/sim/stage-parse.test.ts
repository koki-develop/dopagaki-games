import { describe, expect, test } from 'bun:test';
import { BALL_RADIUS, BLOCK_INSET_X, BLOCK_INSET_Y, BlockType, CELL_H, CELL_W, COLS, GRID_LEFT } from '../config.ts';
import { STAGE_MAX_ROWS, StageParseError, parseStage, stageHardHp } from './stage-parse.ts';

const row = (s: string) => s + '.'.repeat(COLS - s.length);

describe('stageHardHp', () => {
  test('数字は HP、記号は 12 / 20 / 30、それ以外はハードではない', () => {
    for (let d = 2; d <= 9; d++) expect(stageHardHp(String(d))).toBe(d);
    expect(stageHardHp('#')).toBe(12);
    expect(stageHardHp('%')).toBe(20);
    expect(stageHardHp('@')).toBe(30);
    for (const ch of ['0', '1', 'o', 'M', 'X', '.', '', '22', 'x']) expect(stageHardHp(ch)).toBe(0);
  });
});

describe('parseStage', () => {
  test('文字をセルの種類と HP に展開する', () => {
    const p = parseStage({ id: 'demo', name: 'DEMO', rows: [row('o3MX'), row('.@')] });
    expect(p.rowCount).toBe(2);
    expect(p.breakableCount).toBe(4);
    expect(Array.from(p.type.subarray(0, 4))).toEqual([BlockType.Ball, BlockType.Hard, BlockType.Mega, BlockType.Solid]);
    expect(Array.from(p.hp.subarray(0, 4))).toEqual([1, 3, 1, 0]);
    expect(p.type[COLS]).toBe(BlockType.Empty);
    expect(p.type[COLS + 1]).toBe(BlockType.Hard);
    expect(p.hp[COLS + 1]).toBe(30);
  });

  test('配置の誤りは、ステージと位置を示すエラーになる', () => {
    const bad = (rows: string[], id = 'bad') => () => parseStage({ id, name: 'BAD', rows });
    expect(bad(['o'.repeat(COLS + 1)])).toThrow(StageParseError);
    expect(bad(['o'.repeat(COLS + 1)])).toThrow('stage "bad": row 1 has 13 columns; expected 12');
    expect(bad([row('o'), row('ox')])).toThrow('row 2 column 2 has unknown symbol "x"; allowed: . o M X 2-9 # % @');
    expect(bad([row('1')])).toThrow('unknown symbol "1"');
    expect(bad([])).toThrow('has no rows');
    expect(bad([row('')])).toThrow('has no breakable blocks');
    expect(bad([row('XXX')])).toThrow('has no breakable blocks');
    expect(bad(Array.from({ length: STAGE_MAX_ROWS + 1 }, () => row('o')))).toThrow(`at most ${STAGE_MAX_ROWS} fit`);
    expect(bad([row('o')], 'Upper')).toThrow('id must be lowercase');
    expect(() => parseStage({ id: 'ok', name: 'OK', rows: Array.from({ length: STAGE_MAX_ROWS }, () => row('o')) })).not.toThrow();
  });
});

describe('parseStage: ボールの届き方', () => {
  const parse = (rows: string[]) => parseStage({ id: 'reach', name: 'REACH', rows });

  test('壊れないブロックに囲まれた壊せるブロックは、位置を示すエラーになる', () => {
    const rows = ['............', '....XXX.....', '....XoX.....', '....XXX.....', '............'];
    expect(() => parse(rows)).toThrow('stage "reach": row 3 column 6 cannot be reached by a ball; unbreakable blocks seal it off');
  });

  test('天井に接する行は、天井との間を通れない', () => {
    expect(() => parse(['...XoX......', '...XXX......'])).toThrow('row 1 column 5 cannot be reached');
  });

  test('斜めに接する角の間は通れない', () => {
    // 列 5 の o は、上下左右を X と天井に囲まれ、斜めにだけ空きがある
    const rows = ['....XoX.....', '.....X......', '............'];
    expect(() => parse(rows)).toThrow('row 1 column 6 cannot be reached');
  });

  test('壊せるブロックを壊せば届くなら、囲まれていてもよい', () => {
    expect(() => parse(['....XoX.....', '....X9X.....', '............'])).not.toThrow();
    // 扉のさらに奥
    expect(() => parse(['...XXXXX....', '...XMoMX....', '...XXoXX....', '............'])).not.toThrow();
  });

  test('左右の端の列は、壁との間の隙間を通って届く', () => {
    const wall = 'X'.repeat(COLS);
    expect(() => parse(['o..........o', wall, 'o...........'])).not.toThrow();
    expect(() => parse(['.....o......', wall, 'o...........'])).not.toThrow();
    // 端の列まで壊れないブロックで塞ぐと、上へは入れない
    expect(() => parse(['X....o.....X', wall, 'o...........'])).toThrow('row 1 column 6 cannot be reached');
  });

  test('何も入っていない閉じた空間は、ボールが入れないのでそのままでよい', () => {
    expect(() => parse(['....XXX.....', '....X.X.....', '....XXX.....', 'o...........'])).not.toThrow();
  });

  test('届き方の判定が前提にする寸法: 隙間はボールより狭く、空きのセルと左右の隙間はボールより広い', () => {
    const d = BALL_RADIUS * 2;
    // 隣り合うブロックの隙間、斜めに接する角の隙間、天井との隙間
    expect(2 * BLOCK_INSET_X).toBeLessThan(d);
    expect(2 * BLOCK_INSET_Y).toBeLessThan(d);
    expect(Math.hypot(2 * BLOCK_INSET_X, 2 * BLOCK_INSET_Y)).toBeLessThan(d);
    expect(BLOCK_INSET_Y).toBeLessThan(d);
    // 空きのセル 1 つぶんの通り道と、左右の壁との隙間
    expect(CELL_W + 2 * BLOCK_INSET_X).toBeGreaterThan(d);
    expect(CELL_H + 2 * BLOCK_INSET_Y).toBeGreaterThan(d);
    expect(GRID_LEFT + BLOCK_INSET_X).toBeGreaterThan(d);
  });
});
