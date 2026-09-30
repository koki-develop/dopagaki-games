import { useEffect } from 'react';

/** 画面の状態機械へ送る、ページ全体の出来事 */
type ScreenGuardEvent = { t: 'hidden' } | { t: 'escape' };

/** キーの押し下げのうち、扱いを決めるのに使うもの */
export type KeyFacts = {
  readonly key: string;
  readonly repeat: boolean;
  /** フォーカスがボタンにあるか */
  readonly onButton: boolean;
};

/**
 * キーの押し下げの扱い。
 * - escape: 画面の状態機械へ escape を送る。押しっぱなしの繰り返しでは送らない
 * - suppress: ボタンの上での Enter と Space の自動の繰り返し。ボタンを押させない
 * - null: 何もしない
 */
export function keyGuard(e: KeyFacts): 'escape' | 'suppress' | null {
  if (e.key === 'Escape') return e.repeat ? null : 'escape';
  if (e.repeat && e.onButton && (e.key === 'Enter' || e.key === ' ')) return 'suppress';
  return null;
}

/**
 * ゲームの画面に共通する、ページ全体のキーと表示の扱い。dispatch は画面の状態機械の dispatch（同じ関数を渡し続ける）。
 * - タブが隠れたら hidden を送る（プレイ中なら一時停止する。判断は状態機械が行う）
 * - Escape で escape を送る（開いているものを閉じる。プレイ中なら一時停止する）
 * - キーの押しっぱなしによる自動の繰り返しでは、ボタンを押さない。
 *   画面が切り替わると次の画面のボタンにフォーカスが移るので、押し続けた Enter が次の操作まで進めてしまうのを防ぐ
 */
export function useScreenGuards(dispatch: (e: ScreenGuardEvent) => void): void {
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') dispatch({ t: 'hidden' });
    };
    // 捕獲の段階で受け、フォーカスのある要素がキーを処理する前に繰り返しを止める
    const onKeyDown = (e: KeyboardEvent) => {
      const guard = keyGuard({ key: e.key, repeat: e.repeat, onButton: e.target instanceof HTMLButtonElement });
      if (guard === 'escape') dispatch({ t: 'escape' });
      else if (guard === 'suppress') e.preventDefault();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [dispatch]);
}
