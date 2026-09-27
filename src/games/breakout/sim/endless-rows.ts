import { ramp } from '../../../shared/math.ts';
import { BlockType, COLS } from '../config.ts';
import type { SimConfig } from '../config.ts';
import type { BlockField } from './blocks.ts';
import type { Rng } from './rng.ts';


/** [min, max] の整数を一様に選ぶ */
function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng.next() * (max - min + 1));
}

/** プレイ時間 activeTime（秒）での、ハードの出現率 */
export function hardRatioAt(e: SimConfig['endless'], activeTime: number): number {
  const t = ramp(activeTime, e.hardRatioRampSeconds);
  return e.hardRatioStart + (e.hardRatioMax - e.hardRatioStart) * t;
}

/** プレイ時間 activeTime（秒）での、ハードの HP。hardHpMax を超えない */
export function hardHpAt(e: SimConfig['endless'], activeTime: number): number {
  return Math.min(e.hardHpMax, Math.round(e.hardHpStart * (1 + activeTime / e.hardHpScaleSeconds) ** e.hardHpPower));
}

/**
 * エンドレスの行を作る。ブロックは bandRowsMin〜bandRowsMax 行の帯で並べ、
 * 帯と帯の間に gapRowsMin〜gapRowsMax 行の横一直線の空きを挟む。
 * ボールがその空きに入り込み、帯の裏側で暴れられるようにする。
 */
export class EndlessRows {
  private readonly cfg: SimConfig['endless'];
  private readonly rng: Rng;
  /** いまの帯の残りの行数 */
  private bandRowsLeft: number;
  /** 次に挟む空の行の残り */
  private gapRowsLeft = 0;

  constructor(cfg: SimConfig['endless'], rng: Rng) {
    this.cfg = cfg;
    this.rng = rng;
    this.bandRowsLeft = randInt(rng, cfg.bandRowsMin, cfg.bandRowsMax);
  }

  /** field の行 row を埋める。activeTime は難易度に、now は出現時刻（見た目だけに使う値）に使う */
  fill(field: BlockField, row: number, activeTime: number, now: number): void {
    const e = this.cfg;
    if (this.gapRowsLeft > 0) {
      this.gapRowsLeft--;
      return;
    }
    this.bandRowsLeft--;
    if (this.bandRowsLeft <= 0) {
      this.gapRowsLeft = randInt(this.rng, e.gapRowsMin, e.gapRowsMax);
      this.bandRowsLeft = randInt(this.rng, e.bandRowsMin, e.bandRowsMax);
    }
    const hardRatio = hardRatioAt(e, activeTime);
    const hardHp = hardHpAt(e, activeTime);
    for (let col = 0; col < COLS; col++) {
      const r = this.rng.next();
      if (r < e.megaRatio) field.setCell(row, col, BlockType.Mega, 1, now);
      else if (r < e.megaRatio + hardRatio) field.setCell(row, col, BlockType.Hard, hardHp, now);
      else field.setCell(row, col, BlockType.Ball, 1, now);
    }
  }
}
