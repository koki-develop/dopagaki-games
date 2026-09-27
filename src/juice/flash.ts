/**
 * 画面の明滅を 1 秒に 3 回までに抑える（WCAG 2.3.1 Three Flashes or Below Threshold）。
 * 画面全体や広い範囲の明滅、bloom の一時的なブーストは、必ずここを通して許可を得る。
 * プレイをまたいでも制限が続くように、画面（セッション）につき 1 つだけ作る。
 */
export class FlashLimiter {
  private readonly maxPerWindow: number;
  private readonly windowSeconds: number;
  private readonly times: number[] = [];

  constructor(maxPerWindow = 3, windowSeconds = 1) {
    this.maxPerWindow = maxPerWindow;
    this.windowSeconds = windowSeconds;
  }

  /**
   * 時刻 now（実時間の秒）に明滅を 1 回出してよいか問い合わせる。
   * 許可したら記録して true を返す。直近の窓で上限に達していれば false を返す。
   */
  request(now: number): boolean {
    this.prune(now);
    if (this.times.length >= this.maxPerWindow) return false;
    this.times.push(now);
    return true;
  }

  private prune(now: number): void {
    // 窓の境界ちょうどの記録も残す。こうすると、どの長さ windowSeconds の区間にも maxPerWindow 回を超えて入らない
    while (this.times.length > 0 && now - this.times[0] > this.windowSeconds) this.times.shift();
  }
}
