import { describe, expect, test } from 'bun:test';
import { canonicalHash, hrefOf, parseRoute } from './router.ts';

describe('parseRoute', () => {
  test('前後のスラッシュと大文字小文字の違いを無視する', () => {
    for (const h of ['#/breakout', '#breakout', '#/breakout/', '#//BreakOut//']) expect(parseRoute(h)).toBe('breakout');
  });

  test('空や知らないハッシュはポータル', () => {
    for (const h of ['', '#', '#/', '#/nope', '#/breakout/x', '#/portal']) expect(parseRoute(h)).toBe('portal');
  });

  test('正規の形はそのまま読める', () => {
    for (const r of ['portal', 'breakout'] as const) expect(parseRoute(hrefOf(r))).toBe(r);
  });
});

describe('canonicalHash', () => {
  test('正規の形でないハッシュだけを書き換える', () => {
    expect(canonicalHash('#/breakout/')).toBe('#/breakout');
    expect(canonicalHash('#/nope')).toBe('#/');
    expect(canonicalHash('#/breakout')).toBeNull();
    expect(canonicalHash('#/')).toBeNull();
    expect(canonicalHash('')).toBeNull();
  });
});
