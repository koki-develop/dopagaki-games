/**
 * ゲームのセッションの状態。何もないフィールド（idle）か、1 回のプレイ（run）のどちらか。
 * 入力を受け付けるか、世界を進めるか、タップで演出を飛ばせるかは、すべてこの状態から導く。
 *
 * プレイの段階:
 * - ready: 用意できた。世界は進むが、入力はまだ受け付けない
 * - playing: プレイ中
 * - ending: 勝敗が決まり、結果画面までの演出を見せている
 * - afterglow: 結果が確定した。結果画面の後ろで世界は動き続ける
 */
type RunStage = 'ready' | 'playing' | 'ending' | 'afterglow';

export type SessionState =
  | { readonly k: 'idle' }
  | {
      readonly k: 'run';
      readonly id: number;
      readonly stage: RunStage;
      readonly paused: boolean;
      /** 勝敗が決まった時刻（秒、performance.now() / 1000 の時間軸）。まだなら NaN */
      readonly endingAt: number;
    };

export type SessionAction =
  | { readonly t: 'prepare'; readonly id: number }
  | { readonly t: 'begin' }
  | { readonly t: 'setPaused'; readonly paused: boolean }
  | { readonly t: 'ending'; readonly at: number }
  | { readonly t: 'finished' }
  | { readonly t: 'endRun' };

export const IDLE: SessionState = { k: 'idle' };

/** 状態を進める。変わらないときは同じオブジェクトを返す */
export function reduceSession(s: SessionState, a: SessionAction): SessionState {
  if (a.t === 'prepare') return { k: 'run', id: a.id, stage: 'ready', paused: false, endingAt: Number.NaN };
  if (a.t === 'endRun') return s.k === 'idle' ? s : IDLE;
  if (s.k === 'idle') return s;
  switch (a.t) {
    case 'begin':
      return s.stage === 'ready' ? { ...s, stage: 'playing', paused: false } : s;
    case 'setPaused':
      // 止められるのはプレイ中だけ。勝敗が決まった後の演出は止めない（結果を確定させるため）
      if (a.paused) return s.stage === 'playing' && !s.paused ? { ...s, paused: true } : s;
      return s.paused ? { ...s, paused: false } : s;
    case 'ending':
      // 勝敗は世界が進むフレームでしか決まらないので、一時停止中には届かない
      return s.stage === 'ready' || s.stage === 'playing' ? { ...s, stage: 'ending', endingAt: a.at } : s;
    case 'finished':
      return s.stage === 'ending' ? { ...s, stage: 'afterglow' } : s;
  }
}

/** 指とキーの入力を受け付けるか（パドルの操作と、発射・演出の早送りのタップ） */
export function inputActive(s: SessionState): boolean {
  return s.k === 'run' && !s.paused && (s.stage === 'playing' || s.stage === 'ending');
}

/** このフレームで世界を進めるか */
export function worldAdvances(s: SessionState): boolean {
  return s.k === 'run' && !s.paused;
}

/** 離した入力が、発射の合図になるか */
export function releaseLaunches(s: SessionState): boolean {
  return s.k === 'run' && !s.paused && s.stage === 'playing';
}

/** 離した入力（pressedAt に押した）が、演出を飛ばす合図になるか。勝敗が決まった後に押したものだけ */
export function releaseSkips(s: SessionState, pressedAt: number): boolean {
  return s.k === 'run' && !s.paused && s.stage === 'ending' && pressedAt > s.endingAt;
}
