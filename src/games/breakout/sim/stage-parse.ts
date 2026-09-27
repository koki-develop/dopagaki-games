import { BlockType, CELL_H, COLS, DANGER_Y, FIELD_H } from '../config.ts';

/**
 * ステージの配置。`rows` は上から順に並べ、各行は 12 文字。
 * 1 行目の上端がフィールドの天井に接する。
 *
 * - `.`: 空き
 * - `o`: ボール入り
 * - `2`〜`9`: ハード（数字が HP）
 * - `#` / `%` / `@`: ハード（HP 12 / 20 / 30）
 * - `M`: ボール大量
 *
 * `id` はステージを見分ける固定の名前（記録の保存にも使う）。表示名 `name` を変えても変えない。
 */
export type StageDef = {
  readonly id: string;
  readonly name: string;
  readonly rows: readonly string[];
};

/** ステージに並べられる行数の上限。一番下の行が危険ラインより上に収まる数 */
export const STAGE_MAX_ROWS = Math.floor((FIELD_H - DANGER_Y) / CELL_H);

const HARD_SYMBOLS: Readonly<Record<string, number>> = { '#': 12, '%': 20, '@': 30 };

/** ステージの配置の文字から、ハードの HP を返す。ハードでなければ 0 */
export function stageHardHp(ch: string): number {
  if (ch.length === 1 && ch >= '2' && ch <= '9') return ch.charCodeAt(0) - 48;
  return HARD_SYMBOLS[ch] ?? 0;
}

/** 読み込んだステージ。セルは上の行から順に `row * COLS + col` で並ぶ */
type ParsedStage = {
  readonly id: string;
  readonly name: string;
  readonly rowCount: number;
  readonly type: Uint8Array;
  readonly hp: Uint8Array;
  readonly liveCount: number;
};

export class StageParseError extends Error {
  constructor(stageId: string, detail: string) {
    super(`stage "${stageId}": ${detail}`);
    this.name = 'StageParseError';
  }
}

/**
 * ステージの配置を検証して、セルの種類と HP に展開する。
 * 行の幅・文字・行数・HP のどれかが合わなければ、どこが違うかを書いた `StageParseError` を投げる。
 */
export function parseStage(def: StageDef): ParsedStage {
  const id = def.id;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new StageParseError(id, 'id must be lowercase letters, digits or "-"');
  const rows = def.rows;
  if (rows.length === 0) throw new StageParseError(id, 'has no rows');
  if (rows.length > STAGE_MAX_ROWS) throw new StageParseError(id, `has ${rows.length} rows; at most ${STAGE_MAX_ROWS} fit above the danger line`);
  const type = new Uint8Array(rows.length * COLS);
  const hp = new Uint8Array(rows.length * COLS);
  let live = 0;
  for (let r = 0; r < rows.length; r++) {
    const line = rows[r];
    if (line.length !== COLS) throw new StageParseError(id, `row ${r + 1} has ${line.length} columns; expected ${COLS}`);
    for (let col = 0; col < COLS; col++) {
      const ch = line[col];
      const i = r * COLS + col;
      if (ch === '.') continue;
      if (ch === 'o') {
        type[i] = BlockType.Ball;
        hp[i] = 1;
      } else if (ch === 'M') {
        type[i] = BlockType.Mega;
        hp[i] = 1;
      } else {
        const h = stageHardHp(ch);
        if (h === 0) {
          throw new StageParseError(id, `row ${r + 1} column ${col + 1} has unknown symbol "${ch}"; allowed: . o M 2-9 # % @`);
        }
        if (h > 255) throw new StageParseError(id, `row ${r + 1} column ${col + 1} has HP ${h}; at most 255`);
        type[i] = BlockType.Hard;
        hp[i] = h;
      }
      live++;
    }
  }
  if (live === 0) throw new StageParseError(id, 'has no blocks');
  return { id, name: def.name, rowCount: rows.length, type, hp, liveCount: live };
}
