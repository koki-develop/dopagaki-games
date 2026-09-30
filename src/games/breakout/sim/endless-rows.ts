import { ramp } from '../../../shared/math.ts';
import type { Rng } from '../../../shared/rng.ts';
import { BlockType, COLS } from '../config.ts';
import type { SimConfig } from '../config.ts';
import type { BlockField } from './blocks.ts';


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
 *
 * jackpotIntervalSeconds ごとに、いまの帯や空きを打ち切ってジャックポットの帯を差し込む。
 * 外周を切れ目なくハードで囲み、中をすべてメガで埋める。出す時刻は乱数によらず決まる。
 */
export class EndlessRows {
  private readonly cfg: SimConfig['endless'];
  private readonly rng: Rng;
  /** いまの帯の残りの行数 */
  private bandRowsLeft: number;
  /** 次に挟む空の行の残り */
  private gapRowsLeft = 0;
  /** 次のジャックポットを出すプレイ時間 */
  private nextJackpotAt: number;
  /** いまのジャックポットの帯の残りの行数。0 ならジャックポットの帯を並べていない */
  private jackpotRowsLeft = 0;

  constructor(cfg: SimConfig['endless'], rng: Rng) {
    this.cfg = cfg;
    this.rng = rng;
    this.bandRowsLeft = randInt(rng, cfg.bandRowsMin, cfg.bandRowsMax);
    this.nextJackpotAt = cfg.jackpotIntervalSeconds;
  }

  /** field の行 row を埋める。activeTime は難易度に、now は出現時刻（見た目だけに使う値）に使う */
  fill(field: BlockField, row: number, activeTime: number, now: number): void {
    const e = this.cfg;
    if (this.jackpotRowsLeft === 0 && activeTime >= this.nextJackpotAt) {
      this.jackpotRowsLeft = e.jackpotRows;
      while (this.nextJackpotAt <= activeTime) this.nextJackpotAt += e.jackpotIntervalSeconds;
    }
    if (this.jackpotRowsLeft > 0) {
      this.fillJackpot(field, row, activeTime, now);
      return;
    }
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

  /** ジャックポットの帯の 1 行を埋める。帯を並べ終えたら、空きを挟んでふつうの帯に戻る */
  private fillJackpot(field: BlockField, row: number, activeTime: number, now: number): void {
    const e = this.cfg;
    const edge = this.jackpotRowsLeft === e.jackpotRows || this.jackpotRowsLeft === 1;
    const hardHp = hardHpAt(e, activeTime);
    for (let col = 0; col < COLS; col++) {
      if (edge || col === 0 || col === COLS - 1) field.setCell(row, col, BlockType.Hard, hardHp, now);
      else field.setCell(row, col, BlockType.Mega, 1, now);
    }
    this.jackpotRowsLeft--;
    if (this.jackpotRowsLeft === 0) {
      this.gapRowsLeft = randInt(this.rng, e.gapRowsMin, e.gapRowsMax);
      this.bandRowsLeft = randInt(this.rng, e.bandRowsMin, e.bandRowsMax);
    }
  }
}
