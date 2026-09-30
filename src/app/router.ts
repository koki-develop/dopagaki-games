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

/** 画面の切り替えが使う、ブラウザの履歴とスクロールの窓口 */
export type HistoryPort = {
  /** いまの URL のパス */
  pathname(): string;
  /** 履歴を積んで URL のパスを変える */
  pushState(path: string): void;
  scrollToTop(): void;
  /** 戻る・進むで URL が変わったら listener を呼ぶ。返す関数で監視をやめる */
  onPopState(listener: () => void): () => void;
};

export type Router = {
  /** いまの URL のパスが表す画面 */
  getRoute(): Route;
  /** 画面が変わりうるときに listener を呼ぶ。返す関数で購読をやめる */
  subscribe(listener: () => void): () => void;
  /** 履歴を積んで、ページを読み込み直さずに画面を切り替える。いまと同じページなら何もしない */
  navigate(id: PageId): void;
};

/** URL のパスで画面を切り替える。戻る・進むの監視は、購読者がいる間だけ 1 つ置く */
export function createRouter(port: HistoryPort): Router {
  const listeners = new Set<() => void>();
  let stopPopState: (() => void) | null = null;
  const notify = () => {
    for (const l of listeners) l();
  };

  return {
    getRoute: () => parseRoute(port.pathname()),
    subscribe: (listener) => {
      listeners.add(listener);
      stopPopState ??= port.onPopState(notify);
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || !stopPopState) return;
        stopPopState();
        stopPopState = null;
      };
    },
    navigate: (id) => {
      const path = hrefOf(id);
      if (port.pathname() === path) return;
      port.pushState(path);
      // ページを読み込んだときと同じく、新しい画面は先頭から見せる
      port.scrollToTop();
      notify();
    },
  };
}

const browserRouter = createRouter({
  pathname: () => window.location.pathname,
  pushState: (path) => window.history.pushState(null, '', path),
  scrollToTop: () => window.scrollTo(0, 0),
  onPopState: (listener) => {
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  },
});

export const navigate = browserRouter.navigate;

/** URL のパス（/breakout など）で画面を切り替える */
export function useRoute(): Route {
  return useSyncExternalStore(browserRouter.subscribe, browserRouter.getRoute);
}
