import { BestCrossing } from '../../../shared/best-crossing.ts';

/**
 * HUD に出す得点と、最高スコアの更新。
 * 出す得点は、人の手の点を得点の文字を出したときに、終局の石の点を儀式で数えたときに足す。
 * 更新は、対局中の得点（手の点の合計）が、これまでの最高スコアを超えた手で 1 回だけ決まる。記録がない（0）ときは決まらない。
 */
export class ScoreTicker {
  /** HUD に出す得点 */
  shown = 0;
  /** 更新の演出を出した（HUD の BEST の表示） */
  newBest = false;
  private readonly best: BestCrossing;

  /** bestScore は、これまでの最高スコア（記録がなければ 0） */
  constructor(bestScore: number) {
    this.best = new BestCrossing(bestScore);
  }

  /** HUD の得点に points を足す */
  add(points: number): void {
    this.shown += points;
  }

  /** 対局中の得点が total になった。これで最高スコアを初めて超えたなら true（更新の演出を出す） */
  crosses(total: number): boolean {
    return this.best.cross(total);
  }

  /** 更新の演出を出した */
  celebrate(): void {
    this.newBest = true;
  }
}
