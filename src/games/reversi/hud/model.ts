import { formatScore } from '../../../shared/format.ts';
import { clamp } from '../../../shared/math.ts';
import { BLACK } from '../rules/position.ts';
import type { HudState } from '../types.ts';

/** HUD に書く値。文字列と、CSS に渡す数値（小数 3 桁で丸めてある） */
export type HudFrame = {
  /** 人と CPU の石の数 */
  human: string;
  cpu: string;
  /** 数が増えた瞬間の跳ね。0 で静止 */
  humanBump: number;
  cpuBump: number;
  /** 綱引きのバーの、人の側の割合（0〜1）。ばねのように寄せる */
  share: number;
  /** 得点（3 桁ごとに区切る）。実際の得点へ転がるように増える */
  score: string;
  /** 得点が増えている間の跳ね（0〜1） */
  scoreBump: number;
  /** 自己ベストの得点を超えた */
  newBest: boolean;
  /** コンボの窓の残りの割合（0〜1）と、フィーバーの強さ（0〜1） */
  comboWindow: number;
  fever: number;
};

/** 跳ねが収まる速さ（1/秒） */
const BUMP_DECAY = 9;
const BUMP_EPSILON = 1e-3;
/** 得点が実際の値へ寄っていく速さ（1/秒） */
const SCORE_RATE = 10;
/** バーのばねの固さと減衰 */
const SPRING_K = 90;
const SPRING_DAMP = 11;
const SHARE_EPSILON = 5e-4;
const FIRST_DT = 1 / 60;
const MAX_DT = 0.1;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * 1 局ぶんの HUD の表示を決める。DOM には触らない。
 * 石の数が増えた側を跳ねさせ、綱引きのバーは両者の石の割合へばねのように寄せる（行き過ぎて少し戻る）。
 * 得点は実際の値へ転がるように増やす。
 * 別の局の表示には使わない（局ごとに作り直す）。
 * 毎フレーム呼ぶので、返す HudFrame は使い回し、文字列は値が変わったときだけ作る。
 */
export class HudModel {
  private readonly frame: HudFrame = {
    human: '',
    cpu: '',
    humanBump: 0,
    cpuBump: 0,
    share: 0,
    score: '',
    scoreBump: 0,
    newBest: false,
    comboWindow: 0,
    fever: 0,
  };
  /** frame の文字列の元の値。-1 はまだ作っていない */
  private shownHuman = -1;
  private shownCpu = -1;
  private shownScore = -1;
  private human: number;
  private cpu: number;
  private humanBump = 0;
  private cpuBump = 0;
  private share: number;
  private shareVel = 0;
  /** 表示している得点（実数）と、跳ね */
  private score: number;
  private scoreBump = 0;

  /** initial はこの局で最初に届いた値。その値から表示を始める */
  constructor(initial: HudState) {
    const h = humanCount(initial);
    const c = cpuCount(initial);
    this.human = h;
    this.cpu = c;
    this.share = shareOf(h, c);
    this.score = initial.score;
  }

  /** dt: 前回の呼び出しからの実時間（秒）。最初のフレームは null。返す値は、次に update を呼ぶまで有効 */
  update(s: HudState, dt: number | null): HudFrame {
    const step = dt === null ? FIRST_DT : clamp(dt, 0, MAX_DT);
    const h = humanCount(s);
    const c = cpuCount(s);
    if (h > this.human) this.humanBump = Math.min(1, this.humanBump + 0.35 + 0.1 * (h - this.human));
    if (c > this.cpu) this.cpuBump = Math.min(1, this.cpuBump + 0.35 + 0.1 * (c - this.cpu));
    this.human = h;
    this.cpu = c;
    const decay = Math.exp(-step * BUMP_DECAY);
    this.humanBump = settle(this.humanBump * decay);
    this.cpuBump = settle(this.cpuBump * decay);

    // ばね: 行き過ぎて少し戻る。小さなステップに分けて、フレームの長さによらず同じ動きにする
    const target = shareOf(h, c);
    let remaining = step;
    while (remaining > 1e-6) {
      const d = Math.min(remaining, 1 / 240);
      const acc = SPRING_K * (target - this.share) - SPRING_DAMP * this.shareVel;
      this.shareVel += acc * d;
      this.share += this.shareVel * d;
      remaining -= d;
    }
    if (Math.abs(target - this.share) < SHARE_EPSILON && Math.abs(this.shareVel) < SHARE_EPSILON) {
      this.share = target;
      this.shareVel = 0;
    }

    // 得点: 実際の値へ転がる。増えている間は跳ね続ける
    if (s.score > this.score) {
      const next = this.score + (s.score - this.score) * (1 - Math.exp(-step * SCORE_RATE));
      this.score = Math.min(s.score, Math.max(this.score + 1, next));
      this.scoreBump = 1;
    } else {
      this.score = s.score;
      this.scoreBump = settle(this.scoreBump * decay);
    }

    const f = this.frame;
    if (h !== this.shownHuman) {
      this.shownHuman = h;
      f.human = String(h);
    }
    if (c !== this.shownCpu) {
      this.shownCpu = c;
      f.cpu = String(c);
    }
    const score = Math.floor(this.score);
    if (score !== this.shownScore) {
      this.shownScore = score;
      f.score = formatScore(score);
    }
    f.humanBump = round3(this.humanBump);
    f.cpuBump = round3(this.cpuBump);
    f.share = round3(clamp(this.share, 0, 1));
    f.scoreBump = round3(this.scoreBump);
    f.newBest = s.newBest;
    f.comboWindow = round3(s.comboWindow);
    f.fever = round3(s.fever);
    return f;
  }
}

/** 見分けられないほど小さくなった跳ねは 0 にする */
const settle = (v: number): number => (v < BUMP_EPSILON ? 0 : v);

/** 人と CPU の石の数 */
const humanCount = (s: HudState): number => (s.human === BLACK ? s.black : s.white);
const cpuCount = (s: HudState): number => (s.human === BLACK ? s.white : s.black);

/** 人の石の割合。どちらもないときは半分 */
const shareOf = (h: number, c: number): number => (h + c > 0 ? h / (h + c) : 0.5);
