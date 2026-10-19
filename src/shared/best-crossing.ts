/**
 * これまでの最高スコアとの比較。
 * - exceeds: スコアが最高スコアを上回っているか。記録がない（最高スコアが 0）初回も、得点すれば上回る
 * - cross: プレイ中に最高スコアを超えた瞬間か。超えた瞬間の演出（記録の更新）を 1 プレイに 1 回だけ出すのに使う。
 *   記録がない初回は、最初の得点で必ず超えてしまうので、超えたことにしない
 * 1 回のプレイごとに作る。
 */
export class BestCrossing {
  /** プレイを始める前の最高スコア（記録がなければ 0） */
  readonly previousBest: number;
  private crossed = false;

  constructor(previousBest: number) {
    this.previousBest = previousBest;
  }

  /** score が、これまでの最高スコアを上回っているか */
  exceeds(score: number): boolean {
    return score > this.previousBest;
  }

  /** score で、記録のある最高スコアを初めて超えたなら true。1 プレイに 1 回だけ */
  cross(score: number): boolean {
    if (this.crossed || this.previousBest <= 0 || !this.exceeds(score)) return false;
    this.crossed = true;
    return true;
  }
}
