import { createHash } from 'node:crypto';
import { PAGES } from '../../src/app/site.ts';
import type { PageId, Route } from '../../src/app/site.ts';
import { renderIcons } from '../icons.ts';
import { OG_HEIGHT, OG_WIDTH } from '../og/card.ts';
import { OG_CARDS } from '../og/cards.ts';
import { loadFonts } from '../og/fonts.ts';
import { renderOgPng } from '../og/render.ts';
import { renderRobots, renderSitemap } from './crawl.ts';
import type { OgImage, PageDocument } from './head.ts';

/** サイトのルートに置くファイル。path はルートからのパス */
export type SiteFile = { readonly path: string; readonly contentType: string; readonly body: Buffer | string };

/** 画面ごとの HTML ファイル。fileName は出力先のディレクトリからのパス */
export type SitePage = { readonly fileName: string; readonly doc: PageDocument };

export type Site = {
  readonly pages: readonly SitePage[];
  readonly files: readonly SiteFile[];
  readonly documentFor: (route: Route) => PageDocument;
};

/** 画面の HTML のファイル名。本番は cleanUrls で拡張子を外したパス（/breakout）として配信する */
export const pageFileName = (path: string): string => (path === '/' ? 'index.html' : `${path.slice(1)}.html`);
export const NOT_FOUND_FILE = '404.html';

/**
 * OG 画像のファイルの名前に、中身のハッシュを入れる。
 * SNS は画像を URL ごとにキャッシュするので、描き方を変えたら URL も変わるようにする
 */
const contentHash = (body: Buffer): string => createHash('sha256').update(body).digest('hex').slice(0, 12);

async function renderOgImages(): Promise<{ images: ReadonlyMap<PageId, OgImage>; files: SiteFile[] }> {
  const fonts = await loadFonts();
  const images = new Map<PageId, OgImage>();
  const files: SiteFile[] = [];
  for (const page of PAGES) {
    const card = OG_CARDS[page.id];
    const body = await renderOgPng(card, fonts);
    const path = `/og/${page.id}-${contentHash(body)}.png`;
    images.set(page.id, { path, width: OG_WIDTH, height: OG_HEIGHT, type: 'image/png', alt: card.alt });
    files.push({ path, contentType: 'image/png', body });
  }
  return { images, files };
}

/** サイトを配信するのに要るもの（画面ごとの HTML の中身、OG 画像、アイコン、sitemap、robots.txt）をすべて作る */
export async function generateSite(): Promise<Site> {
  const [og, icons] = await Promise.all([renderOgImages(), renderIcons()]);

  const documentFor = (route: Route): PageDocument => {
    if (route === 'notFound') return { route };
    const ogImage = og.images.get(route);
    if (!ogImage) throw new Error(`no OG image for page "${route}"`);
    return { route, ogImage };
  };

  return {
    pages: [
      ...PAGES.map((p) => ({ fileName: pageFileName(p.path), doc: documentFor(p.id) })),
      { fileName: NOT_FOUND_FILE, doc: documentFor('notFound') },
    ],
    files: [
      ...og.files,
      ...icons,
      { path: '/sitemap.xml', contentType: 'application/xml; charset=utf-8', body: renderSitemap() },
      { path: '/robots.txt', contentType: 'text/plain; charset=utf-8', body: renderRobots() },
    ],
    documentFor,
  };
}
