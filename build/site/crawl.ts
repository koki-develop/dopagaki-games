import { absoluteUrl, PAGES } from '../../src/app/site.ts';
import { escapeHtml } from './html.ts';

/**
 * 検索エンジンに知らせるページの一覧。
 * Google は priority と changefreq を読まず、lastmod は正確なときしか使わないので、URL だけを並べる
 */
export function renderSitemap(): string {
  const urls = PAGES.map((p) => `  <url>\n    <loc>${escapeHtml(absoluteUrl(p.path))}</loc>\n  </url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/** すべてのクローラーにすべてのパスを許し、sitemap の場所を絶対 URL で知らせる */
export function renderRobots(): string {
  return ['User-agent: *', 'Allow: /', '', `Sitemap: ${absoluteUrl('/sitemap.xml')}`, ''].join('\n');
}
