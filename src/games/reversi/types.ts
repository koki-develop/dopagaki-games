import type { FatalCause } from '../../shared/fatal.ts';
import type { Color } from './rules/position.ts';
import type { ScoreSheet } from './scoring.ts';

/**
 * リバーシの画面（React）とゲーム本体（GameSession）の間で受け渡す型。
 * 画面の状態機械（controller.ts）は GamePort だけを通してゲームを動かし、ゲームからは SessionEvent を受け取る。
 */

/** 対局の設定。人が持つ色（黒は先手） */
export type MatchSetup = { readonly human: Color };

/** 手番の側 */
export type Side = 'human' | 'cpu';

export type Outcome = 'win' | 'lose' | 'draw';

/** 1 局の結果。結果画面と記録の保存に使う */
export type RunResult = {
  outcome: Outcome;
  /** 終局時の人と CPU の石の数 */
  human: number;
  cpu: number;
  /** 相手の石を 0 にして勝った */
  perfect: boolean;
  /** この対局の最大コンボと、盤が全部埋まるまで一度もコンボが途切れなかったか（フルコンボ） */
  maxCombo: number;
  fullCombo: boolean;
  /** 早打ちの手の数 */
  quickCount: number;
  /** 得点の内訳 */
  score: ScoreSheet;
  /** 合計が、これまでの最高スコア（0 より大きいとき）を超えた */
  newBest: boolean;
  /** 開発用の操作口から任意の局面で始めた対局。記録に残さない */
  practice: boolean;
};

/** HUD に毎フレーム渡す値。runId が変わったら、別のプレイの表示として一から描き直す */
export type HudState = {
  runId: number;
  human: Color;
  /** 盤に見えている石の数。返る演出に合わせて 1 枚ずつ変わる。終局の儀式の間は、数え上げた数 */
  black: number;
  white: number;
  /** 画面に出す得点。人の手の点は得点の文字を出したときに、終局の石の点は儀式で数えたときに足す */
  score: number;
  /** 対局中の得点が、これまでの最高スコアを超えた（その演出を出した） */
  newBest: boolean;
  /** コンボを次へつなぐ窓の残りの割合（1 で人の手番が始まった直後。コンボが 0 のときと窓が閉じているときは 0）と、フィーバーの強さ（0〜1） */
  comboWindow: number;
  fever: number;
};

/**
 * 盤の上に出す短い文字。位置 x, y は、ゲームの中ではワールド座標で、
 * セッションが画面へ渡すときに、描画領域の左上からの CSS ピクセルへ直す。
 * - flips: 人の手で返した枚数。石が返りきるたびに、同じ手（move）の数を数え上げる。
 *   level はその時点の枚数の演出の段階（0〜4）、final はその手の最後の 1 回
 * - score: 人の手の得点。points はこの手の点（早打ちの点を含む）、multiplier はコンボの倍率、quick は早打ちか
 * - combo: 人の手でコンボが 2 以上に積まれた。置いた石の位置に出す
 * - corner: 人が角を取った
 * - pass: どちらかがパスした（who はパスした側）
 * - tally: 終局の儀式で数え上げた人と CPU の石の数。1 組数えるたびに届き、final は最後の組の 1 回
 * - verdict: 終局の儀式の決着
 */
export type Callout =
  | { kind: 'flips'; move: number; count: number; level: number; final: boolean; x: number; y: number }
  | { kind: 'score'; move: number; points: number; multiplier: number; quick: boolean; x: number; y: number }
  | { kind: 'combo'; count: number; x: number; y: number }
  | { kind: 'corner'; x: number; y: number }
  | { kind: 'pass'; who: Side }
  | { kind: 'tally'; human: number; cpu: number; final: boolean }
  | { kind: 'verdict'; outcome: Outcome; perfect: boolean };

/** ゲームから画面へ知らせる出来事 */
export type SessionEvent =
  /** 対局を始めた（開発用の操作口から始めた練習の対局も含む）。画面はこの設定の対局中を出す */
  | { t: 'started'; setup: MatchSetup }
  /** 終局した。ここから結果画面までの演出の間は一時停止できない */
  | { t: 'runEnding' }
  /** 演出が終わり、結果が確定した */
  | { t: 'finished'; result: RunResult }
  /** ゲームを続けられなくなった */
  | { t: 'fatal'; cause: FatalCause; message: string };

/** 画面の状態機械からゲームへの命令 */
export interface GamePort {
  /**
   * 新しい対局を用意して、すぐに始める。ユーザー操作（click / keyup）の中で呼ぶ。音を解錠する。
   * bestScore は、これまでの最高スコア（対局中に超えた瞬間の演出の基準。記録がなければ 0）
   */
  start(setup: MatchSetup, bestScore: number): void;
  setPaused(paused: boolean): void;
  /** 対局を捨てて、何もない盤に戻す */
  endRun(): void;
}

export type SessionCallbacks = {
  onEvent: (e: SessionEvent) => void;
  onHud: (s: HudState) => void;
  onCallout: (c: Callout) => void;
  /** スクリーンリーダーに読み上げさせる文（打った手、パス、終局） */
  onAnnounce: (text: string) => void;
};

/** HUD の配置。盤はこの上下の余白の間に収める */
export type HudLayout = {
  /** 画面上端から HUD の下端までの CSS ピクセル */
  top: number;
  /** 画面下端から空けておく CSS ピクセル（手番の表示と安全領域） */
  bottom: number;
};

/** React 側から見たゲーム本体 */
export interface SessionHandle extends GamePort {
  setHudLayout(layout: HudLayout): void;
  dispose(): void;
}
