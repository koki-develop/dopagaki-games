import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { PAGES } from '../../src/app/site.ts';
import { generateSite } from './generate.ts';
import type { Site } from './generate.ts';

const site: Site = await generateSite();

const fileAt = (path: string) => {
  const file = site.files.find((f) => f.path === path);
  if (!file) throw new Error(`${path} is not generated`);
  return file;
};

describe('generateSite', () => {
  test('ページごとの HTML と 404 の HTML を、本番のパスに対応する名前で作る', () => {
    expect(site.pages.map((p) => p.fileName)).toEqual(['index.html', 'breakout.html', '404.html']);
    expect(site.pages.map((p) => p.doc.route)).toEqual([...PAGES.map((p) => p.id), 'notFound']);
  });

  test('どのページにも 1200×630 の PNG の OG 画像があり、ファイル名に中身のハッシュが入る', async () => {
    for (const page of PAGES) {
      const doc = site.documentFor(page.id);
      if (doc.route === 'notFound') throw new Error('unreachable');
      expect(doc.ogImage.path).toMatch(new RegExp(`^/og/${page.id}-[0-9a-f]{12}\\.png$`));
      expect(doc.ogImage.alt).not.toBe('');
      const meta = await sharp(fileAt(doc.ogImage.path).body).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['png', doc.ogImage.width, doc.ogImage.height]);
    }
  });

  test('同じ描き方からは同じ OG 画像ができる（URL が変わらず、SNS のキャッシュが無駄に切れない）', async () => {
    const again = await generateSite();
    for (const page of PAGES) expect(again.documentFor(page.id)).toEqual(site.documentFor(page.id));
  });

  test('アイコンは index.html が指すパスと大きさで作る', async () => {
    expect(fileAt('/favicon.svg').contentType).toBe('image/svg+xml');
    for (const [path, size] of [
      ['/favicon.png', 96],
      ['/apple-touch-icon.png', 180],
    ] as const) {
      const meta = await sharp(fileAt(path).body).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['png', size, size]);
    }
  });

  test('sitemap.xml と robots.txt を作る', () => {
    expect(fileAt('/sitemap.xml').contentType).toBe('application/xml; charset=utf-8');
    expect(fileAt('/robots.txt').contentType).toBe('text/plain; charset=utf-8');
  });

  test('ファイルのパスは重ならない', () => {
    const paths = site.files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
