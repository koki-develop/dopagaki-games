import { describe, expect, test } from 'bun:test';
import { PAGES } from '../../src/app/site.ts';
import { renderRobots, renderSitemap } from './crawl.ts';

describe('renderSitemap', () => {
  test('すべてのページを本番の絶対 URL で並べる', () => {
    const xml = renderSitemap();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    expect([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1])).toEqual(
      PAGES.map((p) => new URL(p.path, 'https://dopagaki.games').href),
    );
  });
});

describe('renderRobots', () => {
  test('すべてを許し、sitemap の絶対 URL を知らせる', () => {
    expect(renderRobots()).toBe('User-agent: *\nAllow: /\n\nSitemap: https://dopagaki.games/sitemap.xml\n');
  });
});
