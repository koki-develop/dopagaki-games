import { clamp } from '../../shared/math.ts';
import type { SimInput } from './sim/sim.ts';

/**
 * プレイヤーの入力を、固定ステップごとの sim の入力へ直す。1 回のプレイごとに作る。
 *
 * - パドルの目標位置は、指やキーの入力をその場で反映する（描画もこの位置を使う）
 * - 1 フレームで sim を n ステップ進めるときは、前のフレームで最後に渡した位置から今の目標位置まで、
 *   n 等分して 1 ステップずつ近づける。フレームレートが違っても、パドルの速さ（発射の傾き）は同じになる
 * - 発射の合図は、次に進めるステップの最初の 1 回にだけ渡す。そのフレームでステップが進まなければ、次のフレームへ持ち越す
 */
export class PaddleInput {
  private readonly min: number;
  private readonly max: number;
  private targetX: number;
  private fedX: number;
  private launchLatched = false;
  private readonly out: SimInput = { paddleTargetX: 0, launch: false };

  /** min / max はパドルの中心が動ける範囲。start は最初の位置 */
  constructor(min: number, max: number, start: number) {
    this.min = min;
    this.max = Math.max(min, max);
    this.targetX = clamp(start, this.min, this.max);
    this.fedX = this.targetX;
  }

  /** 今の目標位置。パドルはここに描く */
  get target(): number {
    return this.targetX;
  }

  /** 目標位置を dx だけ動かす。有限でない値は無視する */
  moveBy(dx: number): void {
    if (Number.isFinite(dx)) this.targetX = clamp(this.targetX + dx, this.min, this.max);
  }

  /** 目標位置を x にする。有限でない値は無視する */
  moveTo(x: number): void {
    if (Number.isFinite(x)) this.targetX = clamp(x, this.min, this.max);
  }

  /** 次のステップで発射する */
  latchLaunch(): void {
    this.launchLatched = true;
  }

  /**
   * このフレームで進める n ステップぶんの入力を、1 ステップずつ step へ渡す。
   * step に渡す入力は使い回すので、呼び出しの外へ持ち出さない。
   */
  feed(n: number, step: (input: Readonly<SimInput>) => void): void {
    if (n <= 0) return;
    const from = this.fedX;
    const to = this.targetX;
    const out = this.out;
    for (let i = 0; i < n; i++) {
      out.paddleTargetX = i === n - 1 ? to : from + ((to - from) * (i + 1)) / n;
      out.launch = i === 0 && this.launchLatched;
      if (i === 0) this.launchLatched = false;
      step(out);
    }
    this.fedX = to;
  }
}
