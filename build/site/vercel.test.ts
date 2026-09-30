import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

type HeaderRule = { source: string; headers: { key: string; value: string }[] };
type VercelConfig = { cleanUrls?: boolean; trailingSlash?: boolean; headers?: HeaderRule[] };

const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as VercelConfig;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** path への応答に付くヘッダー。source の書き方のうち、このファイルで使う (.*) だけを解釈する */
function headersFor(path: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const rule of config.headers ?? []) {
    const pattern = new RegExp(`^${rule.source.split('(.*)').map(escapeRegExp).join('(.*)')}$`);
    if (pattern.test(path)) for (const h of rule.headers) result.set(h.key.toLowerCase(), h.value);
  }
  return result;
}

describe('vercel.json', () => {
  test('開発サーバーとプレビューが真似る URL の規則（build/site/resolve.ts）と同じ設定', () => {
    expect(config.cleanUrls).toBe(true);
    expect(config.trailingSlash).toBe(false);
  });

  test('名前に中身のハッシュが入るファイルは、変わらないものとして長くキャッシュさせる', () => {
    for (const path of ['/assets/index-abc123.js', '/og/portal-0123456789ab.png'])
      expect(headersFor(path).get('cache-control')).toBe('public, max-age=31536000, immutable');
    for (const path of ['/', '/breakout', '/favicon.svg', '/sitemap.xml']) expect(headersFor(path).has('cache-control')).toBe(false);
  });

  test('どの応答でも、ブラウザに Content-Type を推測させない', () => {
    for (const path of ['/', '/breakout', '/assets/index-abc123.js', '/og/portal-0123456789ab.png', '/nope'])
      expect(headersFor(path).get('x-content-type-options')).toBe('nosniff');
  });
});
