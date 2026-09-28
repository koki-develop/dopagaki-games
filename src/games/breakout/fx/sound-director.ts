import { SoundThrottle } from '../../../juice/audio/throttle.ts';
import type { FrameTime } from '../frame-time.ts';
import type { BreakoutSfx } from '../sounds/sfx.ts';
import type { FrameSummary } from './aggregate.ts';
import type { IntensityMeter } from './intensity.ts';

/** 演出から鳴らす効果音。BreakoutSfx がそのまま当てはまる */
export type SfxPort = Pick<
  BreakoutSfx,
  | 'paddle'
  | 'hardHit'
  | 'breakNote'
  | 'megaBurst'
  | 'ballsZero'
  | 'slam'
  | 'stepThud'
  | 'gameOver'
  | 'peakChord'
  | 'inhale'
  | 'finaleBurst'
  | 'bonusNote'
  | 'resolveChord'
>;

/** 破壊音を鳴らす最短の間隔（秒） */
export const BREAK_MIN_INTERVAL = 0.04;
/** フィナーレの届く音が 1 周する音数 */
const BONUS_STEPS = 40;

/**
 * 1 フレームぶんのイベントの集計から、大量に起きる音（パドル・ハード・破壊・ボール大量ブロック）を鳴らす。
 * パドル・ハード・破壊・フィナーレの届く音は間引いてまとめ、ボール大量ブロックの音は 1 フレームに 1 回にする。
 * どの音も、それを起こしたイベントがあったフレームでだけ鳴らす。
 * 勝敗が決まったら quiesce() で止め、それ以降は大量に起きる音を鳴らさない。
 */
export class SoundDirector {
  private readonly sfx: SfxPort;
  private readonly paddleThrottle = new SoundThrottle({ minInterval: 0.08, rateTau: 0.5, halfGainRate: 12, minGain: 0.3 });
  private readonly hardThrottle = new SoundThrottle({ minInterval: 0.05, rateTau: 0.5, halfGainRate: 15, minGain: 0.35 });
  private readonly breakThrottle = new SoundThrottle({ minInterval: BREAK_MIN_INTERVAL, rateTau: 0.35, halfGainRate: 250, minGain: 0.5 });
  private readonly bonusThrottle = new SoundThrottle({ minInterval: 0.04, rateTau: 0.3, halfGainRate: 25, minGain: 0.5 });
  /** 直前に鳴らした破壊音の音階の位置。chain が続く間は 1 音ごとに 1 つ上がる */
  private breakStep = -1;
  /** まだ鳴らしていないハードの当たりのうち、残り HP の割合の最小値 */
  private hardPendingRatio = 1;
  private quiet = false;

  constructor(sfx: SfxPort) {
    this.sfx = sfx;
  }

  /** 以後、frame() では何も鳴らさない */
  quiesce(): void {
    this.quiet = true;
  }

  /** 1 フレームぶんの音。meter はこのフレームの破壊数で更新した後のもの */
  frame(s: FrameSummary, meter: IntensityMeter, ft: FrameTime): void {
    if (this.quiet) return;
    const sfx = this.sfx;

    // パドルの音: 大量のボールを跳ね返しているとほぼ毎フレーム当たるので、間引いてまとめる
    const paddle = this.paddleThrottle.update(ft.real, ft.realDt, s.paddleCount);
    if (paddle > 0) sfx.paddle(Math.min(1, 0.4 + paddle * 0.1), this.paddleThrottle.gain);

    if (s.hardCount > 0 && s.hardMinRatio < this.hardPendingRatio) this.hardPendingRatio = s.hardMinRatio;
    const hard = this.hardThrottle.update(ft.real, ft.realDt, s.hardCount);
    if (hard > 0) {
      sfx.hardHit(this.hardPendingRatio, hard, this.hardThrottle.gain);
      this.hardPendingRatio = 1;
    }

    // 破壊音: 1 音ごとに音階を 1 つ上げる。chain より先には進めないので、1 音が 1 回の破壊のときは chain と同じ高さになり、
    // chain が切れたら低い音へ戻る
    const breaks = this.breakThrottle.update(ft.real, ft.realDt, s.breaks);
    if (breaks > 0) {
      this.breakStep = Math.min(this.breakStep + 1, Math.max(0, s.maxChain - 1));
      sfx.breakNote(this.breakStep, breaks, meter.intensity, this.breakThrottle.gain);
    }

    if (s.megaCount > 0) sfx.megaBurst(Math.max(0, s.megaChain - 1));
  }

  /**
   * フィナーレで光がスコアへ届いた。arrived はこのフレームに届いた数、collected はこれまでに届いた数の合計。
   * 回収の間は、届かなかったフレームも 0 を渡して毎フレーム呼ぶ（間引きの頻度を正しく減らすため）。
   */
  bonus(arrived: number, collected: number, ft: FrameTime): void {
    const n = this.bonusThrottle.update(ft.real, ft.realDt, arrived);
    if (n === 0) return;
    const gain = Math.min(1.1, 0.35 + 0.15 * Math.log2(1 + n)) * this.bonusThrottle.gain;
    this.sfx.bonusNote(collected % BONUS_STEPS, gain);
  }
}
