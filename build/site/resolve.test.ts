import { describe, expect, test } from 'bun:test';
import { isPageRequest, resolvePage } from './resolve.ts';

describe('resolvePage', () => {
  test('ページのパスはその画面をステータス 200 で返す', () => {
    expect(resolvePage('/')).toEqual({ kind: 'page', route: 'portal', status: 200 });
    expect(resolvePage('/breakout')).toEqual({ kind: 'page', route: 'breakout', status: 200 });
  });

  test('末尾のスラッシュは外した形へリダイレクトする。クエリは残す', () => {
    expect(resolvePage('/breakout/')).toEqual({ kind: 'redirect', location: '/breakout' });
    expect(resolvePage('/breakout//', '?backend=webgl')).toEqual({ kind: 'redirect', location: '/breakout?backend=webgl' });
    expect(resolvePage('/nope/')).toEqual({ kind: 'redirect', location: '/nope' });
    expect(resolvePage('//')).toEqual({ kind: 'redirect', location: '/' });
  });

  test('ページの HTML ファイルの名前は、拡張子を外した形へリダイレクトする', () => {
    expect(resolvePage('/breakout.html')).toEqual({ kind: 'redirect', location: '/breakout' });
    expect(resolvePage('/index.html', '?a=1')).toEqual({ kind: 'redirect', location: '/?a=1' });
  });

  test('どのページにも当たらないパスは 404 の画面をステータス 404 で返す', () => {
    for (const path of ['/nope', '/nope.html', '/BreakOut', '/breakout/x', '/portal', '/index'])
      expect(resolvePage(path)).toEqual({ kind: 'page', route: 'notFound', status: 404 });
  });
});

describe('isPageRequest', () => {
  const HTML = 'text/html,application/xhtml+xml,*/*;q=0.8';

  test('ブラウザがページを開く GET と HEAD', () => {
    for (const path of ['/', '/breakout', '/breakout/', '/breakout.html', '/nope/x']) {
      expect(isPageRequest('GET', HTML, path)).toBe(true);
      expect(isPageRequest('HEAD', HTML, path)).toBe(true);
    }
  });

  test('スクリプトや画像の読み込み、拡張子の付いたファイル、GET と HEAD 以外は含めない', () => {
    expect(isPageRequest('GET', '*/*', '/@vite/client')).toBe(false);
    expect(isPageRequest('GET', undefined, '/breakout')).toBe(false);
    expect(isPageRequest('GET', HTML, '/assets/index-abc.js')).toBe(false);
    expect(isPageRequest('GET', HTML, '/og/portal-0123.png')).toBe(false);
    expect(isPageRequest('POST', HTML, '/breakout')).toBe(false);
  });
});
