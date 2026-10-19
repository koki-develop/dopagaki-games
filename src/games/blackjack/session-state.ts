/**
 * ゲームのセッションの状態。何もない卓（idle）か、1 回のプレイ（run）のどちらか。
 * 操作を受け付けるか、世界を進めるか、タップで演出を飛ばせるかは、すべてこの状態から導く。
 *
 * プレイの段階:
 * - playing: プレイ中（始まりの演出、配る、操作を待つ、ディーラーの番、精算を含む）
 * - ending: 最後のラウンドを終え（か、破産し）、結果画面までの儀式を見せている
 * - afterglow: 結果が確定した。結果画面の後ろで世界は動き続ける
 */
type RunStage = 'playing' | 'ending' | 'afterglow';

export type SessionState =
  | { readonly k: 'idle' }
  | {
      readonly k: 'run';
      readonly stage: RunStage;
      readonly paused: boolean;
      /** 儀式を始めた時刻（秒、performance.now() / 1000 の時間軸）。まだなら NaN */
      readonly endingAt: number;
    };

export type SessionAction =
  | { readonly t: 'start' }
  | { readonly t: 'setPaused'; readonly paused: boolean }
  | { readonly t: 'ending'; readonly at: number }
  | { readonly t: 'finished' }
  | { readonly t: 'endRun' };

export const IDLE: SessionState = { k: 'idle' };

/** 状態を進める。変わらないときは同じオブジェクトを返す */
export function reduceSession(s: SessionState, a: SessionAction): SessionState {
  if (a.t === 'start') return { k: 'run', stage: 'playing', paused: false, endingAt: Number.NaN };
  if (a.t === 'endRun') return s.k === 'idle' ? s : IDLE;
  if (s.k === 'idle') return s;
  switch (a.t) {
    case 'setPaused':
      // 止められるのはプレイ中だけ。終わりの儀式は止めない（結果を確定させるため）
      if (a.paused) return s.stage === 'playing' && !s.paused ? { ...s, paused: true } : s;
      return s.paused ? { ...s, paused: false } : s;
    case 'ending':
      // 終わりは世界が進むフレームでしか決まらないので、一時停止中には届かない
      return s.stage === 'playing' ? { ...s, stage: 'ending', endingAt: a.at } : s;
    case 'finished':
      return s.stage === 'ending' ? { ...s, stage: 'afterglow' } : s;
  }
}

/** 卓への入力（指・マウス・キー）を受け付けるか。プレイ中の操作と、終わりの儀式を飛ばすタップ */
export function inputActive(s: SessionState): boolean {
  return s.k === 'run' && !s.paused && (s.stage === 'playing' || s.stage === 'ending');
}

/** このフレームで世界を進めるか */
export function worldAdvances(s: SessionState): boolean {
  return s.k === 'run' && !s.paused;
}

/** 操作（引く・止める・ダブル・分ける）を受け付けるか */
export function tableInput(s: SessionState): boolean {
  return s.k === 'run' && !s.paused && s.stage === 'playing';
}

/** 離した入力（pressedAt に押した）が、演出を飛ばす合図になるか。儀式を始めた後に押したものだけ */
export function releaseSkips(s: SessionState, pressedAt: number): boolean {
  return s.k === 'run' && !s.paused && s.stage === 'ending' && pressedAt > s.endingAt;
}
