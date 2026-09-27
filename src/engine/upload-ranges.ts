/** GPU へ送る範囲（要素数の単位）。three.js の `updateRanges` の要素と同じ形 */
export type UploadRange = { start: number; count: number };

/**
 * 送り直す範囲を受け取る側。three.js の BufferAttribute / InterleavedBuffer がこの形を満たす。
 *
 * - `needsUpdate = true` で版が上がり、次にそのバッファを使う描画で GPU へ送られる
 * - 送るとき、`updateRanges` が空なら配列全体を、そうでなければ各範囲だけを送り、送ったあと `updateRanges` を空にする
 */
export interface UploadTarget {
  readonly updateRanges: UploadRange[];
  needsUpdate: boolean;
}

/**
 * 送り直す範囲の管理。範囲を足すたびに版を上げ、次の描画で送られるまで範囲を溜めておく。
 *
 * 全体を送る指定は、配列全体を覆う 1 つの範囲として積む。範囲つきで送ったあとは three.js が `updateRanges` を空にするので、
 * 「全体の範囲がまだ積まれている」ことが「全体がまだ送られていない」ことと一致する。
 * それまでに届いた部分的な範囲は全体に含まれるので積まず、全体の指定が部分的な範囲に負けることはない。
 *
 * 範囲の入れ物は使い回すので、毎フレーム呼んでもメモリを確保しない。
 */
export class UploadScheduler {
  private readonly target: UploadTarget;
  private readonly pool: UploadRange[] = [];
  private readonly full: UploadRange;

  /**
   * @param length 配列全体の要素数
   * @param maxRanges 溜めておく範囲の上限。超えたら全体を送る（描画されないまま範囲が増え続けないように）
   */
  constructor(target: UploadTarget, length: number, maxRanges = 8) {
    this.target = target;
    this.full = { start: 0, count: length };
    for (let i = 0; i < maxRanges; i++) this.pool.push({ start: 0, count: 0 });
  }

  /** 全体の送り直しが、まだ GPU へ送られずに残っているか */
  get fullPending(): boolean {
    const r = this.target.updateRanges;
    return r.length > 0 && r[0] === this.full;
  }

  /** 全体を送り直す。送られるまでは、あとから足された部分的な範囲より優先する */
  markAll(): void {
    const r = this.target.updateRanges;
    r.length = 0;
    r.push(this.full);
    this.target.needsUpdate = true;
  }

  /** 要素 [start, start + count) を送り直す */
  mark(start: number, count: number): void {
    if (count <= 0) return;
    if (this.fullPending) {
      this.target.needsUpdate = true;
      return;
    }
    const r = this.target.updateRanges;
    const n = r.length;
    const end = start + count;
    if (n > 0) {
      // 直前の範囲と接するか重なるなら、1 つにまとめる
      const last = r[n - 1];
      const lastEnd = last.start + last.count;
      if (start <= lastEnd && end >= last.start) {
        const s = Math.min(last.start, start);
        last.count = Math.max(lastEnd, end) - s;
        last.start = s;
        this.target.needsUpdate = true;
        return;
      }
    }
    if (n >= this.pool.length) {
      this.markAll();
      return;
    }
    // 送られた範囲は three.js が配列から外すので、積まれている数より後ろの入れ物は空いている
    const slot = this.pool[n];
    slot.start = start;
    slot.count = count;
    r.push(slot);
    this.target.needsUpdate = true;
  }
}
