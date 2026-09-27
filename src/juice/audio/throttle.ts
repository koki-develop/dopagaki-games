import { EventRate } from '../rate.ts';

type ThrottleOptions = {
  /** 音を鳴らす最短の間隔（秒） */
  minInterval: number;
  /** 発生頻度をならす時定数（秒） */
  rateTau: number;
  /** 1 秒あたりこの回数で、1 音の音量が半分になる */
  halfGainRate: number;
  /** 1 音の音量の下限 */
  minGain: number;
};

/**
 * 大量に起きるイベントの音を間引く。
 * - 最短間隔をあけて鳴らし、その間に起きた分は次の 1 音にまとめる
 * - 発生頻度が高いほど 1 音を小さくして、連打で耳が疲れないようにする
 *
 * 毎フレーム呼んでもオブジェクトを作らない。鳴らす音の大きさは update() の後に gain で読む。
 */
export class SoundThrottle {
  private readonly o: ThrottleOptions;
  private readonly events: EventRate;
  private lastAt = -Infinity;
  private pending = 0;
  private lastGain = 1;

  constructor(opts: ThrottleOptions) {
    this.o = opts;
    this.events = new EventRate(opts.rateTau);
  }

  /** 直近に update() が 1 以上を返したときの、1 音の音量 */
  get gain(): number {
    return this.lastGain;
  }

  /**
   * このフレームで起きた回数を渡す。音を鳴らすべきなら、まとめた回数（1 以上）を返し、音量を gain に置く。
   * 鳴らさないときは 0。now と dt は同じ時間軸（秒）で渡す。
   */
  update(now: number, dt: number, hits: number): number {
    const rate = this.events.update(hits, dt);
    this.pending += hits;
    if (this.pending === 0 || now - this.lastAt < this.o.minInterval) return 0;
    this.lastGain = Math.max(this.o.minGain, 1 / (1 + rate / this.o.halfGainRate));
    const count = this.pending;
    this.pending = 0;
    this.lastAt = now;
    return count;
  }
}
