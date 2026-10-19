/** 予定の 1 件。time を過ぎたフレームで run を 1 回呼ぶ */
type Cue<F> = { readonly time: number; readonly run: (frame: F, budget: number) => void };

/**
 * 時刻つきの予定の列。時刻の順に並べて持ち、時刻の来たものを先頭から順に取り出す。
 * 取り出した位置は先頭の添字で覚え、毎フレームの処理では配列を詰め直さない。全部を取り出したら空に戻す。
 * 同じ時刻の予定は、足した順に呼ぶ。呼んだ予定の中で足した予定も、時刻が来ていれば同じフレームのうちに呼ぶ。
 */
export class CueQueue<F> {
  private readonly cues: Cue<F>[] = [];
  private head = 0;

  get size(): number {
    return this.cues.length - this.head;
  }

  /** 時刻 time に run を呼ぶ予定を足す */
  add(time: number, run: Cue<F>['run']): void {
    const cues = this.cues;
    let lo = this.head;
    let hi = cues.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cues[mid].time <= time) lo = mid + 1;
      else hi = mid;
    }
    if (lo === cues.length) cues.push({ time, run });
    else cues.splice(lo, 0, { time, run });
  }

  /** 時刻 now までの予定を、時刻の順に呼ぶ */
  runDue(now: number, frame: F, budget: number): void {
    const cues = this.cues;
    while (this.head < cues.length && cues[this.head].time <= now) {
      const cue = cues[this.head];
      this.head++;
      cue.run(frame, budget);
    }
    if (this.head > 0 && this.head === cues.length) {
      cues.length = 0;
      this.head = 0;
    }
  }

  /** 予定をすべて捨てる */
  clear(): void {
    this.cues.length = 0;
    this.head = 0;
  }
}
