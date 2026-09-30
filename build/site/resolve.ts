import { parseRoute } from '../../src/app/site.ts';
import type { Route } from '../../src/app/site.ts';

/** ページを開くリクエストへの応答。正規の形へのリダイレクトか、ある画面の HTML か */
type PageResolution =
  | { readonly kind: 'redirect'; readonly location: string }
  | { readonly kind: 'page'; readonly route: Route; readonly status: 200 | 404 };

/**
 * ページのパスを、本番（vercel.json の cleanUrls: true と trailingSlash: false）と同じ規則で解決する。
 * 開発サーバーとプレビューサーバーがこれを使い、本番と同じ URL で同じ画面とステータスを返す。
 *
 * - 末尾のスラッシュは、外した形へ 308 でリダイレクトする
 * - ページの HTML ファイルの名前（/index.html、/breakout.html）は、拡張子を外した形へ 308 でリダイレクトする
 * - どのページにも当たらなければ、404 の画面をステータス 404 で返す
 */
export function resolvePage(pathname: string, search = ''): PageResolution {
  const trimmed = pathname === '/' ? pathname : pathname.replace(/\/+$/, '') || '/';
  if (trimmed !== pathname) return { kind: 'redirect', location: trimmed + search };

  if (pathname.endsWith('.html')) {
    const clean = pathname.slice(0, -'.html'.length).replace(/^\/index$/, '/');
    if (parseRoute(clean) !== 'notFound') return { kind: 'redirect', location: clean + search };
  }

  const route = parseRoute(pathname);
  return { kind: 'page', route, status: route === 'notFound' ? 404 : 200 };
}

/** ページを開くリクエストか。スクリプトや画像の読み込みはブラウザが Accept に text/html を入れないので、ここで分けられる */
export function isPageRequest(method: string | undefined, accept: string | undefined, pathname: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (!accept?.includes('text/html')) return false;
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  return !last.includes('.') || last.endsWith('.html');
}
