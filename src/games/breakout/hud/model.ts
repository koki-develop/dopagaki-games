import { clamp, clamp01 } from '../../../shared/math.ts';
import type { HudState } from '../types.ts';
import { formatScore } from '../../../shared/format.ts';

/** HUD に書く値。文字列と、CSS に渡す 0〜1 程度の数値（小数 3 桁で丸めてある） */
export type HudFrame = {
  score: string;
  /** 得点が入った瞬間の跳ね。0 で静止 */
  bump: number;
  /** スコアの光。chain 倍率と跳ねから決まる */
  glow: number;
  best: string;
  /** chain の表示。chain が続いていないときは空文字 */
  chain: string;
  lives: number;
  maxLives: number;
  newBest: boolean;
};

/** 表示のスコアが実際の値へ追いつく速さ（1/秒） */
const COUNT_RATE = 14;
/** 跳ねが収まる速さ（1/秒） */
const BUMP_DECAY = 10;
/** これより小さな跳ねは 0 とみなす。止まった後は値が変わらず、DOM にも書かない */
const BUMP_EPSILON = 1e-3;
/** 最初のフレームの経過時間と、1 フレームの経過時間の上限（秒） */
const FIRST_DT = 1 / 60;
const MAX_DT = 0.1;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * 1 プレイぶんの HUD の表示を決める。DOM には触らない。
 * スコアは実際の値へ素早く追いつくようにカウントアップし、大きく入るほど強く跳ねる。chain 倍率が上がるほど強く光る。
 * 別のプレイの表示には使わない（プレイごとに作り直す）。
 * 毎フレーム呼ぶので、返す HudFrame は使い回し、文字列は元の値が変わったときだけ作る。
 */
export class HudModel {
  private readonly frame: HudFrame = { score: '', bump: 0, glow: 0, best: '', chain: '', lives: 0, maxLives: 0, newBest: false };
  /** frame の文字列の元の値。-1 はまだ作っていない */
  private shownScoreInt = -1;
  private shownBest = -1;
  private shownChain = -1;
  private shownMultiplier = -1;
  private shown: number;
  private last: number;
  private bump = 0;

  /** initial はこのプレイで最初に届いた値。その値から表示を始める */
  constructor(initial: HudState) {
    this.shown = initial.score;
    this.last = initial.score;
  }

  /** dt: 前回の呼び出しからの実時間（秒）。最初のフレームは null。返す値は、次に update を呼ぶまで有効 */
  update(s: HudState, dt: number | null): HudFrame {
    const step = dt === null ? FIRST_DT : clamp(dt, 0, MAX_DT);
    if (s.score > this.last) this.bump = Math.min(1, this.bump + 0.08 + Math.log10(1 + s.score - this.last) * 0.06);
    this.last = s.score;
    this.bump *= Math.exp(-step * BUMP_DECAY);
    if (this.bump < BUMP_EPSILON) this.bump = 0;
    const diff = s.score - this.shown;
    this.shown = Math.abs(diff) < 1 ? s.score : this.shown + diff * Math.min(1, step * COUNT_RATE);

    const f = this.frame;
    const score = Math.round(this.shown);
    if (score !== this.shownScoreInt) {
      this.shownScoreInt = score;
      f.score = formatScore(score);
    }
    if (s.best !== this.shownBest) {
      this.shownBest = s.best;
      f.best = formatScore(s.best);
    }
    const chain = s.chain >= 2 ? s.chain : 0;
    if (chain !== this.shownChain || (chain > 0 && s.multiplier !== this.shownMultiplier)) {
      this.shownChain = chain;
      this.shownMultiplier = s.multiplier;
      f.chain = chain > 0 ? `${chain} CHAIN ×${s.multiplier.toFixed(2)}` : '';
    }
    const glow = clamp01((s.multiplier - 1) / 4);
    f.bump = round3(this.bump);
    f.glow = round3(glow + this.bump * 0.5);
    f.lives = s.lives;
    f.maxLives = s.maxLives;
    f.newBest = s.newBest;
    return f;
  }
}
