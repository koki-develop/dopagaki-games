import { absoluteUrl, documentTitle, pageOf, SITE_LOCALE, SITE_NAME } from '../../src/app/site.ts';
import type { PageId } from '../../src/app/site.ts';
import { escapeHtml, replaceOnce, voidTag } from './html.ts';

/** ページの OG 画像。path はサイトのルートからのパス */
export type OgImage = {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly type: string;
  readonly alt: string;
};

/** 1 枚の HTML が表す画面。どのページにも当たらないパスには notFound の HTML をステータス 404 で返す */
export type PageDocument = { readonly route: PageId; readonly ogImage: OgImage } | { readonly route: 'notFound' };

const meta = (key: 'name' | 'property', name: string, content: string) => voidTag('meta', { [key]: name, content });

/** ページごとの <head> の中身。題名・説明・canonical・OGP・X のカード */
export function renderHead(doc: PageDocument): string {
  const title = `<title>${escapeHtml(documentTitle(doc.route))}</title>`;
  // 404 の画面は検索結果に載せない。この HTML が 404 以外のステータスで返る経路（/404 を直接開くなど）があっても載らないよう明示する
  if (doc.route === 'notFound') return [title, meta('name', 'robots', 'noindex')].join('\n    ');

  const page = pageOf(doc.route);
  const url = absoluteUrl(page.path);
  const image = doc.ogImage;
  return [
    title,
    meta('name', 'description', page.description),
    voidTag('link', { rel: 'canonical', href: url }),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', SITE_NAME),
    meta('property', 'og:locale', SITE_LOCALE),
    meta('property', 'og:url', url),
    meta('property', 'og:title', page.title),
    meta('property', 'og:description', page.description),
    meta('property', 'og:image', absoluteUrl(image.path)),
    meta('property', 'og:image:type', image.type),
    meta('property', 'og:image:width', String(image.width)),
    meta('property', 'og:image:height', String(image.height)),
    meta('property', 'og:image:alt', image.alt),
    // X は題名・説明・画像を og: から読むので、大きい画像のカードにするための指定だけを書く
    meta('name', 'twitter:card', 'summary_large_image'),
  ].join('\n    ');
}

/**
 * index.html（ビルド後の、スクリプトやスタイルの読み込みが入ったもの）から、ある画面の HTML を作る。
 * <head> の末尾にページごとのタグを足し、<html> に画面の名前（data-route）を書く。
 * data-route を最初から書いておくのは、ゲームの画面でスクロールを止めるスタイルを、スクリプトが動く前から効かせるため
 */
export function renderDocument(indexHtml: string, doc: PageDocument): string {
  const withRoute = replaceOnce(indexHtml, /<html\b([^>]*)>/, (_, attrs) => `<html${attrs} data-route="${doc.route}">`);
  return replaceOnce(withRoute, /<\/head>/, () => `  ${renderHead(doc)}\n  </head>`);
}
