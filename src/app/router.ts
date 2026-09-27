import { useSyncExternalStore } from 'react';

type Route = 'portal' | 'breakout';

const ROUTES: readonly Route[] = ['portal', 'breakout'];

export const hrefOf = (r: Route): string => (r === 'portal' ? '#/' : `#/${r}`);

/** URL のハッシュを画面に対応づける。前後のスラッシュと大文字小文字の違いは無視し、知らないハッシュはポータルにする */
export function parseRoute(hash: string): Route {
  const path = hash
    .replace(/^#/, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  return ROUTES.find((r) => r !== 'portal' && r === path) ?? 'portal';
}

/**
 * 表記を正規の形（hrefOf）へそろえたハッシュ。いまのハッシュがすでに正規の形なら null。
 * ハッシュがないときはポータルのままでよいので null
 */
export function canonicalHash(hash: string): string | null {
  if (hash === '' || hash === '#') return null;
  const canonical = hrefOf(parseRoute(hash));
  return canonical === hash ? null : canonical;
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

/** URL のハッシュ（#/breakout など）で画面を切り替える */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => parseRoute(window.location.hash));
}
