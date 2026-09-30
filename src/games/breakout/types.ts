import type { FatalCause } from '../../shared/fatal.ts';

/**
 * ブロック崩しの画面（React）とゲーム本体（GameSession）の間で受け渡す型。
 * 画面の状態機械（controller.ts）は GamePort だけを通してゲームを動かし、ゲームからは SessionEvent を受け取る。
 */

export type RunMode = { kind: 'endless' } | { kind: 'stage'; index: number };

/** 1 プレイの結果。結果画面と記録の保存に使う */
export type RunResult = {
  mode: RunMode;
  cleared: boolean;
  score: number;
  /** このプレイを始める前のベストスコア */
  previousBest: number;
  newBest: boolean;
};

/** HUD に毎フレーム渡す値。runId が変わったら、別のプレイの表示として一から描き直す */
export type HudState = {
  runId: number;
  score: number;
  chain: number;
  multiplier: number;
  best: number;
  newBest: boolean;
  /** ステージの残機。エンドレスでは使わない */
  lives: number;
  maxLives: number;
};

/** ゲームから画面へ知らせる出来事 */
export type SessionEvent =
  /** 勝敗が決まった（ステージクリアかゲームオーバー）。ここから結果画面までの演出の間は一時停止できない */
  | { t: 'runEnding' }
  /** 演出が終わり、結果が確定した */
  | { t: 'finished'; result: RunResult }
  /** ゲームを続けられなくなった */
  | { t: 'fatal'; cause: FatalCause; message: string };

/** 画面の状態機械からゲームへの命令 */
export interface GamePort {
  /** 新しいプレイを用意する。ブロックを並べ、ボールをパドルに乗せる。入力はまだ受け付けない */
  prepare(mode: RunMode, previousBest: number): void;
  /** ユーザー操作（pointerup / keyup）の中で呼ぶ。音を解錠して、プレイを始める */
  begin(): void;
  setPaused(paused: boolean): void;
  /** プレイを捨てて、何もないフィールドに戻す */
  endRun(): void;
}

export type SessionCallbacks = {
  onEvent: (e: SessionEvent) => void;
  onHud: (s: HudState) => void;
};

/** HUD の配置。フィールドはこの高さの下に収め、得点に変わった光はスコアの位置へ吸い込まれる */
export type HudLayout = {
  /** 画面上端から HUD の下端までの CSS ピクセル */
  top: number;
  /** 画面下端から空けておく CSS ピクセル（安全領域と、指で操作する端末で指を置く余白） */
  bottom: number;
  /** スコアの中心。ゲームの描画領域の左上からの CSS ピクセル */
  scoreAnchor: { x: number; y: number } | null;
};

/** React 側から見たゲーム本体 */
export interface SessionHandle extends GamePort {
  setHudLayout(layout: HudLayout): void;
  dispose(): void;
}
