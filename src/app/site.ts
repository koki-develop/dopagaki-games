/**
 * サイトとページの情報。画面の切り替え（router.ts）と、ビルド時に作る HTML・OG 画像・sitemap が共有する。
 * ブラウザの機能も React も使わない素の値だけにして、ビルドのコード（Node）からも読めるようにする
 */

/** 本番の配信元。canonical・og:url・og:image・sitemap は、開発中もこの絶対 URL で書く */
export const SITE_ORIGIN = 'https://dopagaki.games';
export const SITE_NAME = 'DOPAGAKI GAMES';
export const SITE_LOCALE = 'ja_JP';

export type PageMeta = {
  /** パス。先頭は /、末尾に / を付けない（ポータルの / を除く） */
  readonly path: string;
  /** ページ固有の名前。og:title にはこれをそのまま使い、サイト名は og:site_name で別に渡す */
  readonly title: string;
  readonly description: string;
};

const PORTAL = {
  id: 'portal',
  path: '/',
  title: SITE_NAME,
  description: 'ドパガキのためのブラウザゲーム集です。',
} as const satisfies PageMeta & { id: string };

/** 遊べるゲーム。ポータルにはこの順に番号を振って並べる */
export const GAMES = [
  {
    id: 'breakout',
    path: '/breakout',
    title: 'ブロック崩し',
    description: 'ドパガキのためのブロック崩しです。',
  },
] as const satisfies readonly (PageMeta & { id: string })[];

export const PAGES = [PORTAL, ...GAMES] as const;

export type PageId = (typeof PAGES)[number]['id'];

/** 表示する画面。どのページのパスにも当たらなければ notFound */
export type Route = PageId | 'notFound';

/** どのパスにも当たらないときの表示。サーバーはこの画面をステータス 404 で返す */
export const NOT_FOUND_TITLE = 'ページが見つかりません';

export function pageOf(id: PageId): PageMeta {
  const page = PAGES.find((p) => p.id === id);
  if (!page) throw new Error(`page "${id}" is not defined`);
  return page;
}

/**
 * パスを画面に対応づける。完全に一致したものだけを認める。
 * 末尾のスラッシュや .html の付いた形は、配信側（Vercel と開発サーバー）が正規の形へリダイレクトしてから渡す
 */
export function parseRoute(pathname: string): Route {
  return PAGES.find((p) => p.path === pathname)?.id ?? 'notFound';
}

/** ブラウザのタブや検索結果に出す題名。ポータルはサイト名だけ、ほかは「ページ名 | サイト名」 */
export function documentTitle(id: Route): string {
  if (id === 'portal') return SITE_NAME;
  const title = id === 'notFound' ? NOT_FOUND_TITLE : pageOf(id).title;
  return `${title} | ${SITE_NAME}`;
}

/** 本番の絶対 URL */
export const absoluteUrl = (path: string): string => new URL(path, SITE_ORIGIN).href;
