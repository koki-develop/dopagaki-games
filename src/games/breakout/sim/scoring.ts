import { BlockType } from '../config.ts';
import type { SimConfig } from '../config.ts';
import { SIM_LONG_AGO } from './blocks.ts';

/**
 * スコアと chain。chain は前回の破壊から chainWindow 秒以内に次を壊すと続き、ボールの数に関係なく全体で 1 つ。
 * 得点は基礎点 × chain 倍率（1 + chain / chainDivisor、上限 chainMultMax）を丸めたもの。
 */
export class Scoring {
  private readonly cfg: SimConfig['score'];
  score = 0;
  chain = 0;
  lastBreakTime = SIM_LONG_AGO;
  /** ステージクリアのボールボーナスのうち、まだ得点にしていないボールの数 */
  clearBonusRemaining = 0;

  constructor(cfg: SimConfig['score']) {
    this.cfg = cfg;
  }

  get multiplier(): number {
    return Math.min(this.cfg.chainMultMax, 1 + this.chain / this.cfg.chainDivisor);
  }

  /** ブロックの基礎点。ハードは最大 HP に比例する */
  basePoints(type: BlockType, maxHp: number): number {
    const s = this.cfg;
    return type === BlockType.Mega ? s.pointsMega : type === BlockType.Hard ? s.pointsHardPerHp * maxHp : s.pointsBall;
  }

  /** ブロックを壊した。chain を進めて得点を加え、新しい chain 数を返す */
  onBreak(time: number, type: BlockType, maxHp: number): number {
    this.chain = time - this.lastBreakTime <= this.cfg.chainWindow ? this.chain + 1 : 1;
    this.lastBreakTime = time;
    this.score += Math.round(this.basePoints(type, maxHp) * this.multiplier);
    return this.chain;
  }

  /** 上限を超えて出てこられなかったボール 1 個ぶんの得点（chain 倍率がかかる） */
  onOverflow(): void {
    this.score += Math.round(this.cfg.pointsOverflow * this.multiplier);
  }

  /** 前回の破壊から chainWindow 秒を過ぎていたら chain を切る */
  decay(time: number): void {
    if (time - this.lastBreakTime > this.cfg.chainWindow) this.chain = 0;
  }

  /** ステージクリアの時点で残っていたボールの数を、ボールボーナスの対象にする */
  startClearBonus(balls: number): void {
    this.clearBonusRemaining = balls;
  }

  /** ボールボーナスを n 個ぶん（残りが少なければ残りの分だけ）得点にする。chain 倍率はかからない。得点にした数を返す */
  creditClearBonus(n: number): number {
    const k = Math.min(Math.max(0, Math.floor(n)), this.clearBonusRemaining);
    if (!(k > 0)) return 0;
    this.clearBonusRemaining -= k;
    this.score += k * this.cfg.pointsClearBall;
    return k;
  }
}
