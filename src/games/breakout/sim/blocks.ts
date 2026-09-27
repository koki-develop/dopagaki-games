import {
  BLOCK_INSET_Y,
  BlockType,
  CELL_H,
  CELL_W,
  COLS,
  GRID_LEFT,
} from '../config.ts';

/** 行のリングバッファの容量。フィールドに並ぶ行数（最大でも約 47 行）より十分大きくする */
export const ROW_CAPACITY = 64;
/** 行の位置を比べるときの許容誤差。行の y は加算を重ねるので、ちょうど境界にある行がわずかにずれる */
export const ROW_EPS = 1e-6;
/**
 * sim 時刻（プレイの開始が 0 で、負にならない）の上で「ずっと前」を表す値。
 * まだ一度も当たっていないセルの hitAt などに入れる。いまの時刻との差がどの演出の長さよりも大きいので、
 * 読む側は特別扱いせずに「とうに終わった」として扱える。Float32Array にも誤差なく入る。
 */
export const SIM_LONG_AGO = -1e9;

/** x 座標が含まれる列。格子の外なら範囲外の値（負または COLS 以上）になる */
export function colAtX(x: number): number {
  return Math.floor((x - GRID_LEFT) / CELL_W);
}

/** 列 col のセルの左端 x */
export function cellLeft(col: number): number {
  return GRID_LEFT + col * CELL_W;
}

/** 列 col のブロック矩形の中心 x */
export function cellCenterX(col: number): number {
  return GRID_LEFT + (col + 0.5) * CELL_W;
}

/**
 * ブロックの格子の読み取り用の面。セルの添字は `slotOf(row) * COLS + col`。
 * 型付き配列は中身を書き換えられてしまうが、書き換えてよいのは sim だけ。
 */
export interface ReadonlyBlockField {
  readonly type: Uint8Array;
  readonly hp: Uint8Array;
  readonly maxHp: Uint8Array;
  /** 最後に当たった sim 時刻。揺れの演出に使う */
  readonly hitAt: Float32Array;
  /** 出現した sim 時刻。出現の演出に使う */
  readonly bornAt: Float32Array;
  /** リングバッファの枠ごとの、生きているブロックの数 */
  readonly rowLive: Uint8Array;
  readonly bottomSlot: number;
  readonly rowCount: number;
  /** 一番下の行の下端 y */
  readonly lowestRowY: number;
  readonly liveCount: number;
  /** セルの中身（種類・HP・当たった時刻・出現時刻）か、格子の位置が変わるたびに増える */
  readonly version: number;
  slotOf(row: number): number;
  rowBottomY(row: number): number;
  topRowBottomY(): number;
  centerY(row: number): number;
  rowAtY(y: number): number;
  liveCountBelow(y: number): number;
  lowestLiveBlockBottom(): number;
}

/**
 * ブロックの格子。行はリングバッファで持ち、行どうしは常に CELL_H 間隔で隙間なく並ぶ。
 * 一番下の行の下端 y（`lowestRowY`）だけを動かせば、全体が降りていく。
 * 書き換えはすべてメソッドを通し、そのたびに `version` を増やす。
 */
export class BlockField implements ReadonlyBlockField {
  readonly type = new Uint8Array(ROW_CAPACITY * COLS);
  readonly hp = new Uint8Array(ROW_CAPACITY * COLS);
  readonly maxHp = new Uint8Array(ROW_CAPACITY * COLS);
  readonly hitAt = new Float32Array(ROW_CAPACITY * COLS).fill(SIM_LONG_AGO);
  readonly bornAt = new Float32Array(ROW_CAPACITY * COLS).fill(SIM_LONG_AGO);
  readonly rowLive = new Uint8Array(ROW_CAPACITY);

  bottomSlot = 0;
  rowCount = 0;
  lowestRowY = 0;
  liveCount = 0;
  version = 0;

  slotOf(row: number): number {
    return (this.bottomSlot + row) % ROW_CAPACITY;
  }

  rowBottomY(row: number): number {
    return this.lowestRowY + row * CELL_H;
  }

  topRowBottomY(): number {
    return this.lowestRowY + (this.rowCount - 1) * CELL_H;
  }

  centerY(row: number): number {
    return this.rowBottomY(row) + CELL_H / 2;
  }

  /** y 座標が含まれる行番号。範囲外なら -1 */
  rowAtY(y: number): number {
    const row = Math.floor((y - this.lowestRowY) / CELL_H);
    return row >= 0 && row < this.rowCount ? row : -1;
  }

  /** 下端が y より下にある行の、生きているブロックの数。浮動小数の誤差で y ちょうどの行は含めない */
  liveCountBelow(y: number): number {
    let n = 0;
    for (let row = 0; row < this.rowCount; row++) {
      if (this.rowBottomY(row) >= y - ROW_EPS) break;
      n += this.rowLive[this.slotOf(row)];
    }
    return n;
  }

  /** 生きているブロックの矩形の下端のうち、最も低いもの。ブロックがなければ Infinity */
  lowestLiveBlockBottom(): number {
    for (let row = 0; row < this.rowCount; row++) {
      if (this.rowLive[this.slotOf(row)] > 0) return this.rowBottomY(row) + BLOCK_INSET_Y;
    }
    return Infinity;
  }

  /** 全体を y だけ下げる（負なら上げる） */
  shiftDown(d: number): void {
    this.lowestRowY -= d;
    this.version++;
  }

  /** 空の行を並べ直す位置を決める。行がないときだけ使う */
  placeAt(lowestRowY: number): void {
    if (this.rowCount !== 0) throw new Error('BlockField: placeAt requires an empty field');
    this.lowestRowY = lowestRowY;
    this.version++;
  }

  /** 行を一番上に追加し、その行の番号（下から数えた位置）を返す */
  pushRowTop(): number {
    if (this.rowCount >= ROW_CAPACITY) throw new Error(`BlockField: row capacity (${ROW_CAPACITY}) exceeded`);
    const row = this.rowCount;
    const slot = this.slotOf(row);
    const base = slot * COLS;
    this.type.fill(BlockType.Empty, base, base + COLS);
    this.hp.fill(0, base, base + COLS);
    this.maxHp.fill(0, base, base + COLS);
    this.hitAt.fill(SIM_LONG_AGO, base, base + COLS);
    this.bornAt.fill(SIM_LONG_AGO, base, base + COLS);
    this.rowLive[slot] = 0;
    this.rowCount++;
    this.version++;
    return row;
  }

  popRowBottom(): void {
    if (this.rowCount === 0) return;
    const slot = this.bottomSlot;
    this.liveCount -= this.rowLive[slot];
    this.rowLive[slot] = 0;
    this.bottomSlot = (this.bottomSlot + 1) % ROW_CAPACITY;
    this.rowCount--;
    this.lowestRowY += CELL_H;
    this.version++;
  }

  clearAll(): void {
    this.rowCount = 0;
    this.liveCount = 0;
    this.bottomSlot = 0;
    this.rowLive.fill(0);
    this.version++;
  }

  setCell(row: number, col: number, type: BlockType, hp: number, now: number): void {
    if (hp < 0 || hp > 255) throw new Error(`BlockField: hp ${hp} does not fit in 0..255`);
    const slot = this.slotOf(row);
    const i = slot * COLS + col;
    const wasLive = this.type[i] !== BlockType.Empty;
    this.type[i] = type;
    this.hp[i] = hp;
    this.maxHp[i] = hp;
    this.bornAt[i] = now;
    this.hitAt[i] = SIM_LONG_AGO;
    const isLive = type !== BlockType.Empty;
    if (wasLive !== isLive) {
      const d = isLive ? 1 : -1;
      this.rowLive[slot] += d;
      this.liveCount += d;
    }
    this.version++;
  }

  /** セルの HP を 1 減らして残りを返す。0 になったら空にする（行と全体の生存数も更新する） */
  damageAt(index: number): number {
    const hp = this.hp[index] - 1;
    if (hp > 0) {
      this.hp[index] = hp;
      this.version++;
      return hp;
    }
    this.removeAt(index);
    return 0;
  }

  /** セルに当たった時刻を記録する */
  markHit(index: number, now: number): void {
    this.hitAt[index] = now;
    this.version++;
  }

  /** セルの添字を空にする。行と全体の生存数も更新する */
  removeAt(index: number): void {
    if (this.type[index] === BlockType.Empty) return;
    this.type[index] = BlockType.Empty;
    this.hp[index] = 0;
    const slot = (index / COLS) | 0;
    this.rowLive[slot]--;
    this.liveCount--;
    this.version++;
  }

  /** 一番下の空行を捨てる。空でない行が一番下に来るまで繰り返す */
  pruneEmptyBottomRows(): void {
    while (this.rowCount > 0 && this.rowLive[this.bottomSlot] === 0) this.popRowBottom();
  }
}
