import type { FatalCause } from '../../shared/fatal.ts';
import type { BetChip } from './denominations.ts';
import type { Action } from './rules/round.ts';
import type { ScoreSheet } from './scoring.ts';

/**
 * ブラックジャックの画面（React）とゲーム本体（GameSession）の間で受け渡す型。
 * 画面の状態機械（controller.ts）は GamePort だけを通してゲームを動かし、ゲームからは SessionEvent を受け取る。
 * 賭けのボタン（チップを置く・取り消す・配る）と操作のボタン（引く・止める・ダブル・分ける）は、状態機械を通さずに SessionHandle でゲームへ渡す。
 */

/**
 * 1 回のプレイの結果の種類。
 * - profit: 始めより手持ちが増えた
 * - even: 始めと同じ
 * - loss: 始めより減った（賭けられるだけは残っている）
 * - broke: 賭けられるだけのチップがなくなって、途中で終わった
 */
export type Outcome = 'profit' | 'even' | 'loss' | 'broke';

/** 1 回のプレイの結果。結果画面と記録の保存に使う */
export type RunResult = {
  outcome: Outcome;
  /** 配ったラウンドの数 */
  rounds: number;
  /** プレイヤーのブラックジャックの数と、最大の連勝 */
  blackjacks: number;
  maxStreak: number;
  /** 得点の内訳。合計（total）が最後の手持ちのチップで、これがスコア */
  score: ScoreSheet;
  /** プレイを始める前の最高スコア（記録がなければ 0。練習のプレイでは 0） */
  previousBest: number;
  /** 合計が、previousBest（0 より大きいとき）を超えた */
  newBest: boolean;
  /** 開発用の操作口から配るカードを決めて始めたプレイ。記録に残さない */
  practice: boolean;
};

/**
 * 手の合計の札の状態。
 * - waiting: まだ決着していない手
 * - active: 操作を待っている手
 * - bust / blackjack / win / lose / push: 決着
 */
export type LabelState = 'waiting' | 'active' | 'bust' | 'blackjack' | 'win' | 'lose' | 'push';

/** 手（ディーラーの手を含む）の上に出す、合計の札。毎フレーム同じ入れ物を書き換える */
export type HandLabel = {
  /** 出すか（カードが 1 枚もない手と、使っていない手の枠は出さない） */
  shown: boolean;
  /** 見えているカードの合計と、A を 11 と数えているか */
  total: number;
  soft: boolean;
  state: LabelState;
  /** 札を置く位置（描画領域の左上からの CSS ピクセル）。札の中心 */
  x: number;
  y: number;
};

/** 手の賭けのチップの山に添える、賭けの額の札。毎フレーム同じ入れ物を書き換える */
export type BetLabel = {
  /** 出すか（賭けのチップがない手は出さない） */
  shown: boolean;
  amount: number;
  /** 手が 3 つ以上で、札を並べる幅が狭い（BET の字を省いて小さく出す） */
  crowded: boolean;
  /** 札を置く位置（描画領域の左上からの CSS ピクセル）。札の中心。賭けの丸のすぐ下 */
  x: number;
  y: number;
  /** 札に使える幅（CSS ピクセル。その手に使える幅）。札がこれより広ければ縮めて収める */
  width: number;
};

/**
 * 賭けを選んでいる間の値。毎フレーム同じ入れ物を書き換える。
 * - open: 賭けを選んでいる（チップを置く・取り消す・配るを受け付ける）
 * - bet: 置いている賭け（0 は何も置いていない）
 * - limit: 賭けられる上限（手持ち）
 */
export type BetSlip = { open: boolean; bet: number; limit: number };

/** 操作のボタンを押せるか。毎フレーム同じ入れ物を書き換える */
export type ActionAvailability = Record<Action, boolean>;

/** HUD に毎フレーム渡す値。runId が変わったら、別のプレイの表示として一から描き直す */
export type HudState = {
  runId: number;
  /** 画面に出す手持ちのチップ。払い戻しは、チップが手持ちへ戻る演出に合わせて足す */
  chips: number;
  /** 最後の手持ちが、これまでの最高スコアを超えた（終わりの儀式で、その演出を出した） */
  newBest: boolean;
  /** 今の連勝と、次に勝ったラウンドに掛かる倍率（1/10 単位）、フィーバーの強さ（0〜1） */
  streak: number;
  nextMultiplierTenths: number;
  fever: number;
  /** 今のラウンド（1〜ROUNDS。賭けを選んでいる間は、これから配るラウンド）と、最後のラウンドか */
  round: number;
  finalRound: boolean;
  slip: BetSlip;
  actions: ActionAvailability;
  dealer: HandLabel;
  /** プレイヤーの手。長さは MAX_HANDS で、使っていない枠は shown が false */
  hands: HandLabel[];
  /** 手ごとの賭けの額の札。長さは MAX_HANDS */
  bets: BetLabel[];
};

/**
 * 卓の上に出す短い文字。位置 x, y は、ゲームの中ではワールド座標で、セッションが画面へ渡すときに CSS ピクセルへ直す。
 * - blackjack: プレイヤーの手がブラックジャック
 * - dealerBust: ディーラーがバーストした。celebrate は、そのラウンドに勝ったか（差し引き 0 か負けなら光らせない）
 * - payout: 勝ったラウンドの増減。total は上乗せを含めた増え方、bonus は連勝の上乗せ、multiplierTenths は倍率。level は演出の段階（0〜4）
 * - loss: 負けたラウンドの増減（total は負）
 * - push: 差し引き 0 のラウンド
 * - streak: 連勝が積まれた（2 以上）。count は連勝、multiplierTenths は次に勝ったラウンドに掛かる倍率
 * - streakBreak: 積んでいた連勝が途切れた
 * - finalRound: 最後のラウンドの賭けを選び始めた
 * - reshuffle: シューが尽きたので、捨てたカードを混ぜ直した
 * - verdict: 終わりの儀式の決着。net は始めからの増減
 */
export type Callout =
  | { kind: 'blackjack'; x: number; y: number }
  | { kind: 'dealerBust'; celebrate: boolean; x: number; y: number }
  | { kind: 'payout'; total: number; bonus: number; multiplierTenths: number; level: number; x: number; y: number }
  | { kind: 'loss'; total: number; x: number; y: number }
  | { kind: 'push'; x: number; y: number }
  | { kind: 'streak'; count: number; multiplierTenths: number }
  | { kind: 'streakBreak'; count: number }
  | { kind: 'finalRound' }
  | { kind: 'reshuffle' }
  | { kind: 'verdict'; outcome: Outcome; net: number };

/** ゲームから画面へ知らせる出来事 */
export type SessionEvent =
  /** プレイを始めた（開発用の操作口から始めた練習のプレイも含む）。画面はプレイ中を出す */
  | { t: 'started' }
  /** 最後のラウンドを精算した（か、破産した）。ここから結果画面までの演出の間は一時停止できない */
  | { t: 'runEnding' }
  /** 演出が終わり、結果が確定した */
  | { t: 'finished'; result: RunResult }
  /** ゲームを続けられなくなった */
  | { t: 'fatal'; cause: FatalCause; message: string };

/** 画面の状態機械からゲームへの命令 */
export interface GamePort {
  /**
   * 新しいプレイを用意して、すぐに始める。ユーザー操作（click / keyup）の中で呼ぶ。音を解錠する。
   * bestScore は、これまでの最高スコア（終わりの儀式で、最高スコアの更新を知らせる基準。記録がなければ 0）
   */
  start(bestScore: number): void;
  setPaused(paused: boolean): void;
  /** プレイを捨てて、何もない卓に戻す */
  endRun(): void;
}

export type SessionCallbacks = {
  onEvent: (e: SessionEvent) => void;
  onHud: (s: HudState) => void;
  onCallout: (c: Callout) => void;
  /** スクリーンリーダーに読み上げさせる文（配ったカード、合計、決着） */
  onAnnounce: (text: string) => void;
};

/** HUD の配置。卓はこの上下の余白の間に収める */
export type HudLayout = {
  /** 画面上端から HUD の下端までの CSS ピクセル */
  top: number;
  /** 画面下端から空けておく CSS ピクセル（操作のボタンと安全領域） */
  bottom: number;
};

/** React 側から見たゲーム本体 */
export interface SessionHandle extends GamePort {
  setHudLayout(layout: HudLayout): void;
  /**
   * 操作のボタン（とキー）。操作を待っているときに選べない操作は、鈍い音で知らせる。
   * 操作を待つ直前に押した操作は覚えて待ち始めたら選び（先行入力）、それ以外の、操作を待っていない間の操作は黙って捨てる
   */
  act(action: Action): void;
  /** 賭けのボタン（とキー）。賭けを選んでいる間だけ受け付け、受け付けられない操作は鈍い音で知らせる */
  placeChip(value: BetChip): void;
  /** 手持ちをすべて賭ける */
  allIn(): void;
  clearBet(): void;
  deal(): void;
  dispose(): void;
}
