import { describe, expect, test } from 'bun:test';
import { renderDocument, renderHead } from './head.ts';
import type { OgImage } from './head.ts';
import { escapeHtml } from './html.ts';

const ogImage: OgImage = { path: '/og/breakout-0123abcd.png', width: 1200, height: 630, type: 'image/png', alt: '説明 "引用" & <記号>' };

const INDEX = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

describe('escapeHtml', () => {
  test('本文と属性値で意味を持つ文字をエスケープする', () => {
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe('a&#38;b&#60;c&#62;d&#34;e&#39;f');
  });
});

describe('renderHead', () => {
  const head = renderHead({ route: 'breakout', ogImage });

  test('題名・説明・canonical・OGP・X のカードを本番の絶対 URL で書く', () => {
    expect(head).toContain('<title>ブロック崩し | DOPAGAKI GAMES</title>');
    expect(head).toContain('<meta name="description" content="ドパガキのためのブロック崩しです。">');
    expect(head).toContain('<link rel="canonical" href="https://dopagaki.games/breakout">');
    expect(head).toContain('<meta property="og:url" content="https://dopagaki.games/breakout">');
    expect(head).toContain('<meta property="og:title" content="ブロック崩し">');
    expect(head).toContain('<meta property="og:site_name" content="DOPAGAKI GAMES">');
    expect(head).toContain('<meta property="og:locale" content="ja_JP">');
    expect(head).toContain('<meta property="og:image" content="https://dopagaki.games/og/breakout-0123abcd.png">');
    expect(head).toContain('<meta property="og:image:width" content="1200">');
    expect(head).toContain('<meta property="og:image:height" content="630">');
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  test('属性値はエスケープする', () => {
    expect(head).toContain('<meta property="og:image:alt" content="説明 &#34;引用&#34; &#38; &#60;記号&#62;">');
  });

  test('ポータルの canonical はサイトのルート', () => {
    expect(renderHead({ route: 'portal', ogImage })).toContain('<link rel="canonical" href="https://dopagaki.games/">');
  });

  test('404 の画面は検索結果に載せず、canonical と OGP を持たない', () => {
    const notFound = renderHead({ route: 'notFound' });
    expect(notFound).toContain('<title>ページが見つかりません | DOPAGAKI GAMES</title>');
    expect(notFound).toContain('<meta name="robots" content="noindex">');
    expect(notFound).not.toContain('canonical');
    expect(notFound).not.toContain('og:');
  });
});

describe('renderDocument', () => {
  test('ゲームの画面なら <html> に data-game を書き、<head> の末尾にタグを足す', () => {
    const html = renderDocument(INDEX, { route: 'breakout', ogImage });
    expect(html).toContain('<html lang="ja" data-game>');
    expect(renderDocument(INDEX, { route: 'portal', ogImage })).toContain('<html lang="ja">');
    expect(html.indexOf('<title>')).toBeGreaterThan(html.indexOf('<meta charset="UTF-8" />'));
    expect(html.indexOf('<title>')).toBeLessThan(html.indexOf('</head>'));
    expect(html).toContain('<div id="root"></div>');
  });

  test('テンプレートの形が想定と違えばエラーにする', () => {
    expect(() => renderDocument(INDEX.replace('</head>', ''), { route: 'notFound' })).toThrow();
    expect(() => renderDocument(INDEX.replace('<html lang="ja">', ''), { route: 'notFound' })).toThrow();
  });
});
