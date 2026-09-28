import { useSyncExternalStore } from 'react';
import { pageOf, parseRoute } from './site.ts';
import type { PageId, Route } from './site.ts';

export const hrefOf = (id: PageId): string => pageOf(id).path;

/** クリックの状態のうち、ページ内で遷移してよいかの判断に使うもの */
export type ClickFacts = {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly defaultPrevented: boolean;
};

/**
 * リンクのクリックを横取りしてページ内で遷移してよいか。
 * 修飾キーつき（新しいタブやウィンドウで開く、ダウンロードする）や左ボタン以外のクリックは、ブラウザに任せる
 */
export const isPlainClick = (e: ClickFacts): boolean =>
  e.button === 0 && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener('popstate', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('popstate', cb);
  };
};

/** 履歴を積んで、ページを読み込み直さずに画面を切り替える。いまと同じページなら履歴を積まない */
export function navigate(id: PageId): void {
  const path = hrefOf(id);
  if (window.location.pathname === path) return;
  window.history.pushState(null, '', path);
  // ページを読み込んだときと同じく、新しい画面は先頭から見せる
  window.scrollTo(0, 0);
  for (const cb of listeners) cb();
}

/** URL のパス（/breakout など）で画面を切り替える */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => parseRoute(window.location.pathname));
}
