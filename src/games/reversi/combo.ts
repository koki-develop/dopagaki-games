/**
 * コンボ。人の手番が始まってから COMBO_WINDOW 秒以内に打つと 1 つ積み、間に合わなければ途切れて 0 に戻る。
 * 途切れた後に打った手は、新しいコンボの 1 手目（1）になる。人の手を打った後のコンボは、いつも 1 以上。
 * 人がパスしたら途切れる。時刻は世界時間（一時停止の間は進まない）。
 */
export const COMBO_WINDOW = 2;

/**
 * 人の手番が始まってからこの秒数（世界時間）以内に打った手は、早打ちとして点を足す（scoring.ts の SCORE.quick）。
 * 対局の最初の手番は、相手の手を受けていないので早打ちにしない
 */
export const QUICK_WINDOW = 0.6;

/** 人が打った手の、コンボへの効き方 */
export type ComboHit = {
  /** 窓の中で打ち、コンボが続いたか（false なら、この手から数え直した） */
  continued: boolean;
  /** 早打ちか（窓を開けてから QUICK_WINDOW 秒以内） */
  quick: boolean;
};

/** フィーバー: コンボが start から始まり、full で最大になる */
export const FEVER = { start: 5, full: 20 } as const;

/** コンボ count のときのフィーバーの強さ（0〜1）。start 未満は 0 */
export function feverLevel(count: number): number {
  if (count < FEVER.start) return 0;
  return Math.min(1, (count - FEVER.start + 1) / (FEVER.full - FEVER.start + 1));
}

export class Combo {
  /** 今のコンボと、この対局の最大 */
  count = 0;
  best = 0;
  /** 窓を開けた世界時間。閉じていれば NaN */
  private openedAt = Number.NaN;
  /** 今開いている窓で、早打ちを数えるか（対局の最初の手番でないか） */
  private quickable = false;
  /** 対局の始めから一度も途切れていないか（窓を過ぎた、窓の外で打った、人がパスした） */
  private intact = true;

  /** 人の手番が始まった。時刻 now から窓を開ける。quickable は、早打ちを数える手番か（対局の最初の手番なら false） */
  start(now: number, quickable: boolean): void {
    this.openedAt = now;
    this.quickable = quickable;
  }

  /** 人が打った。窓の中なら 1 つ積む。間に合わなかったら、この手から数え直して 1 にする */
  hit(now: number): ComboHit {
    const elapsed = now - this.openedAt;
    const inside = this.isOpen && elapsed <= COMBO_WINDOW;
    const quick = this.isOpen && this.quickable && elapsed <= QUICK_WINDOW;
    this.openedAt = Number.NaN;
    this.count = inside ? this.count + 1 : 1;
    if (!inside) this.intact = false;
    if (this.count > this.best) this.best = this.count;
    return { continued: inside, quick };
  }

  /** 人がパスした。窓を閉じて途切れさせる。途切れる前の数を返す */
  pass(): number {
    const broken = this.count;
    this.openedAt = Number.NaN;
    this.count = 0;
    this.intact = false;
    return broken;
  }

  /** 1 手以上打ち、最初の手から今まで一度も途切れていない（フルコンボの条件の 1 つ） */
  get unbroken(): boolean {
    return this.intact && this.best > 0;
  }

  /** 窓を過ぎていれば閉じて途切れさせる。途切れたときは途切れる前の数を返し、それ以外は 0 */
  expire(now: number): number {
    if (!this.isOpen || now - this.openedAt <= COMBO_WINDOW) return 0;
    this.openedAt = Number.NaN;
    this.intact = false;
    const broken = this.count;
    this.count = 0;
    return broken;
  }

  /** 対局が終わった。窓を閉じ、今のコンボを 0 にする（最大は残す） */
  close(): void {
    this.openedAt = Number.NaN;
    this.count = 0;
  }

  /** 窓の残りの割合（1 で開けた直後、0 で閉じている） */
  remaining(now: number): number {
    if (!this.isOpen) return 0;
    return Math.max(0, 1 - (now - this.openedAt) / COMBO_WINDOW);
  }

  private get isOpen(): boolean {
    return !Number.isNaN(this.openedAt);
  }
}
