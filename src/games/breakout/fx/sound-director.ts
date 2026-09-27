import { SoundThrottle } from '../../../juice/audio/throttle.ts';
import type { FrameTime } from '../frame-time.ts';
import type { BreakoutSfx } from '../sounds/sfx.ts';
import type { FrameSummary } from './aggregate.ts';
import type { IntensityMeter } from './intensity.ts';
import { WaterfallSwitch } from './intensity.ts';

/** 演出から鳴らす効果音。BreakoutSfx がそのまま当てはまる */
export type SfxPort = Pick<
  BreakoutSfx,
  | 'paddle'
  | 'hardHit'
  | 'breakNote'
  | 'waterfallNote'
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

/** 音の滝の 1 秒あたりの音数 */
export const WATERFALL_NOTES_PER_SEC = 22;
/** 音の滝を先に予約しておく長さの下限（秒）。フレームが長いときは 1.5 フレームぶんまで延ばす */
export const WATERFALL_LOOKAHEAD = 0.1;
/** フィナーレの届く音が 1 周する音数 */
const BONUS_STEPS = 40;

/**
 * 1 フレームぶんのイベントの集計から、大量に起きる音（パドル・ハード・破壊・音の滝・ボール大量ブロック）を鳴らす。
 * パドル・ハード・フィナーレの届く音は間引いてまとめ、ボール大量ブロックの音は 1 フレームに 1 回にする。
 * 勝敗が決まったら quiesce() で止め、それ以降は大量に起きる音を鳴らさない。
 */
export class SoundDirector {
  private readonly sfx: SfxPort;
  private readonly audioNow: () => number;
  private readonly paddleThrottle = new SoundThrottle({ minInterval: 0.08, rateTau: 0.5, halfGainRate: 12, minGain: 0.3 });
  private readonly hardThrottle = new SoundThrottle({ minInterval: 0.05, rateTau: 0.5, halfGainRate: 15, minGain: 0.35 });
  private readonly bonusThrottle = new SoundThrottle({ minInterval: 0.04, rateTau: 0.3, halfGainRate: 25, minGain: 0.5 });
  private readonly waterfall = new WaterfallSwitch();
  private waterfallNext = 0;
  private waterfallStep = 0;
  /** まだ鳴らしていないハードの当たりのうち、残り HP の割合の最小値 */
  private hardPendingRatio = 1;
  private quiet = false;

  /** audioNow は AudioContext の時刻（音の予約に使う） */
  constructor(sfx: SfxPort, audioNow: () => number) {
    this.sfx = sfx;
    this.audioNow = audioNow;
  }

  /** 以後、frame() では何も鳴らさない。予約済みの音の滝も、これより先の分は予約しない */
  quiesce(): void {
    this.quiet = true;
    this.waterfall.on = false;
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

    if (this.waterfall.update(meter.rate)) {
      const t = this.audioNow();
      if (this.waterfallNext < t) {
        // 途切れていた（またはフレームが止まっていた）ときは、過ぎた分をまとめて鳴らさず、今から並べ直す
        this.waterfallNext = t;
        this.waterfallStep = Math.max(this.waterfallStep, s.maxChain - 1);
      }
      const gain = Math.min(1.2, 0.35 + 0.18 * Math.log2(1 + meter.rate / 10));
      const until = t + Math.max(WATERFALL_LOOKAHEAD, 1.5 * ft.realDt);
      while (this.waterfallNext < until) {
        sfx.waterfallNote(this.waterfallStep++, this.waterfallNext, gain, meter.intensity);
        this.waterfallNext += 1 / WATERFALL_NOTES_PER_SEC;
      }
    } else if (s.breaks > 0) {
      sfx.breakNote(Math.max(0, s.maxChain - 1), s.breaks, meter.intensity);
      this.waterfallStep = s.maxChain;
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
