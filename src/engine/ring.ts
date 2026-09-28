/** インスタンス単位で送り直す範囲を受け取る側（InstanceBuffer がこの形を満たす） */
export interface DirtySink {
  /** インスタンス [first, first + count) を送り直す */
  markDirty(first: number, count: number): void;
  /** 全体を送り直す */
  markAllDirty(): void;
}

/**
 * 描画するインスタンス数。
 * three.js は `count > 1` かどうかで描画オブジェクトのキャッシュキーを変えるので、
 * 数が 1 と 2 以上を行き来するとパイプラインを作り直してしまう。常に 2 以上にして、
 * 使わないインスタンスは大きさ 0 のデータで描かないようにする。
 */
export const drawCount = (n: number): number => Math.max(2, n);

/**
 * 予算（0〜1）を掛けた実効容量（最低 1）。予算が数でなければ 1 とみなす。
 * リングへ書き込む側が、上書きされるまでに書ける数を見積もるときも、この値を使う
 */
export function effectiveCapacity(capacity: number, budget: number): number {
  const b = Number.isFinite(budget) ? Math.min(1, Math.max(0, budget)) : 1;
  return Math.max(1, Math.min(capacity, Math.round(capacity * b)));
}

/**
 * リングバッファの書き込み位置と、GPU へ送り直す範囲の管理。GPU のデータには触らない。
 *
 * - 書き込む場所は `claim()` で 1 つずつ受け取る。実効容量（容量 × 予算）に達したら先頭へ戻り、古いものから上書きする
 * - 1 回の `flush()` までに書いた場所は、多くても 2 つの連続した範囲になる（末尾まで + 先頭から）。
 *   実効容量を一周するほど書いたときだけ、使った範囲全体を送る
 * - 描画するインスタンス数は、これまでに書いた一番後ろまで（`clear()` で 0 に戻る）
 */
export class RingCursor {
  readonly capacity: number;
  private readonly sink: DirtySink;
  private effective: number;
  private head = 0;
  private highWater = 0;
  // flush までに書いた範囲。a が先、b が先頭へ戻ってからの範囲。end が start 以下なら空
  private aStart = 0;
  private aEnd = 0;
  private bStart = 0;
  private bEnd = 0;
  private overflow = false;

  constructor(capacity: number, sink: DirtySink) {
    if (capacity < 2) throw new Error(`RingCursor: capacity must be at least 2 (got ${capacity})`);
    this.capacity = capacity;
    this.sink = sink;
    this.effective = capacity;
  }

  /** 次に書き込む場所 */
  get position(): number {
    return this.head;
  }

  /**
   * 描画するインスタンス数。これまでに書いた一番後ろまで（容量は超えない）。
   * 予算を下げても、それより前に書いたものが消えきるまで描けるよう、`clear()` までは縮めない
   */
  get drawCount(): number {
    return Math.min(this.capacity, drawCount(this.highWater));
  }

  /** 予算（0〜1）。実効容量は容量 × 予算（最低 1、`effectiveCapacity`） */
  setBudget(budget: number): void {
    this.effective = effectiveCapacity(this.capacity, budget);
    if (this.head >= this.effective) this.head = 0;
  }

  /** 書き込む場所を 1 つ受け取る。呼び出し側はその場所のデータを書き換える */
  claim(): number {
    const i = this.head;
    this.record(i);
    this.head = i + 1;
    if (this.head > this.highWater) this.highWater = this.head;
    if (this.head >= this.effective) this.head = 0;
    return i;
  }

  /** 前回の flush からの書き込み範囲を送り直す指定に変える */
  flush(): void {
    if (this.overflow) {
      this.sink.markDirty(0, this.highWater);
    } else {
      if (this.aEnd > this.aStart) this.sink.markDirty(this.aStart, this.aEnd - this.aStart);
      if (this.bEnd > this.bStart) this.sink.markDirty(this.bStart, this.bEnd - this.bStart);
    }
    this.resetSpans();
  }

  /**
   * 書き込み位置と描画数を 0 に戻し、全体を送り直す指定にする。
   * 呼び出し側は、先にデータ全体を「描かれない」値にしておく
   */
  clear(): void {
    this.head = 0;
    this.highWater = 0;
    this.resetSpans();
    this.sink.markAllDirty();
  }

  private resetSpans(): void {
    this.aStart = this.aEnd = this.bStart = this.bEnd = 0;
    this.overflow = false;
  }

  private record(i: number): void {
    if (this.overflow) return;
    if (this.aEnd <= this.aStart) {
      this.aStart = i;
      this.aEnd = i + 1;
      return;
    }
    if (this.bEnd <= this.bStart) {
      if (i === this.aEnd) {
        this.aEnd++;
        return;
      }
      // 先頭へ戻った（または予算の変更で書き込み位置が戻った）。a と重ならなければ 2 つ目の範囲にする
      if (i + 1 <= this.aStart) {
        this.bStart = i;
        this.bEnd = i + 1;
        return;
      }
      this.overflow = true;
      return;
    }
    // b を伸ばす。a に追いついたら、一周したので全体を送る
    if (i === this.bEnd && i + 1 <= this.aStart) {
      this.bEnd++;
      return;
    }
    this.overflow = true;
  }
}
