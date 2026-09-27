/** ボール数の段階の閾値。段階 1〜4 に入る数 */
const TIER_THRESHOLDS = [25, 100, 250, 500] as const;
/** 段階が下がるのは、閾値のこの割合を下回ったとき */
const TIER_DOWN_RATIO = 0.8;

/**
 * ボール数から段階を決める。上がるのは閾値に達したとき、下がるのは閾値の 80% を下回ったとき（ヒステリシス）。
 * 段階は BGM の層や背景の変化をなめらかに寄せていく目標で、段階が変わった瞬間に単発の演出は出さない。
 */
export class TierTracker {
  tier = 0;

  update(balls: number): void {
    while (this.tier < TIER_THRESHOLDS.length && balls >= TIER_THRESHOLDS[this.tier]) this.tier++;
    while (this.tier > 0 && balls < TIER_THRESHOLDS[this.tier - 1] * TIER_DOWN_RATIO) this.tier--;
  }
}
