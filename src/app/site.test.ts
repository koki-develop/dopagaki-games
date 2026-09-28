import { describe, expect, test } from 'bun:test';
import { absoluteUrl, documentTitle, PAGES, parseRoute, SITE_NAME } from './site.ts';

describe('PAGES', () => {
  test('パスは / で始まり、末尾に / を付けず、重ならない', () => {
    const paths = PAGES.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path).toMatch(/^\/([a-z0-9-]+)?$/);
    }
  });

  test('id は重ならない', () => {
    const ids = PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('題名と説明は空でない', () => {
    for (const p of PAGES) {
      expect(p.title.trim()).not.toBe('');
      expect(p.description.trim()).not.toBe('');
    }
  });
});

describe('parseRoute', () => {
  test('どのページも自分のパスで読める', () => {
    for (const p of PAGES) expect(parseRoute(p.path)).toBe(p.id);
  });

  test('正規の形でないパスや知らないパスは notFound', () => {
    for (const path of ['/breakout/', '/breakout.html', '/BreakOut', '/index.html', '//breakout', '/portal', '/nope', '/breakout/x', ''])
      expect(parseRoute(path)).toBe('notFound');
  });
});

describe('documentTitle', () => {
  test('ポータルはサイト名だけ、ほかは「ページ名 | サイト名」', () => {
    expect(documentTitle('portal')).toBe(SITE_NAME);
    expect(documentTitle('breakout')).toBe(`ブロック崩し | ${SITE_NAME}`);
    expect(documentTitle('notFound')).toBe(`ページが見つかりません | ${SITE_NAME}`);
  });
});

describe('absoluteUrl', () => {
  test('本番の配信元の絶対 URL にする', () => {
    expect(absoluteUrl('/')).toBe('https://dopagaki.games/');
    expect(absoluteUrl('/breakout')).toBe('https://dopagaki.games/breakout');
  });
});
