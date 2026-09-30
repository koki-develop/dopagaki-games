import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** src の TypeScript のソースをすべてつなげたもの。カスタムプロパティを style から渡す箇所を探す */
const srcDir = new URL('..', import.meta.url).pathname;
const tsSources = (readdirSync(srcDir, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f) && !/\.test(-support)?\.tsx?$/.test(f))
  .map((f) => readFileSync(join(srcDir, f), 'utf8'))
  .join('\n');

const declarations = (property: RegExp): string[] =>
  [...css.matchAll(new RegExp(`(?:^|[;{\\s])(?:${property.source})\\s*:\\s*([^;}]+)`, 'g'))].map((m) => (m[1] ?? '').trim());

const ANIMATION_KEYWORDS = new Set([
  'none', 'both', 'forwards', 'backwards', 'infinite', 'alternate', 'alternate-reverse', 'reverse', 'normal',
  'running', 'paused', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end',
]);

/** animation と animation-name の値から、キーフレームの名前を取り出す */
function referencedKeyframes(): Set<string> {
  const names = new Set<string>();
  for (const value of [...declarations(/animation/), ...declarations(/animation-name/)]) {
    const withoutFunctions = value.replace(/[a-z-]+\([^()]*(?:\([^()]*\)[^()]*)*\)/g, ' ');
    for (const token of withoutFunctions.split(/[\s,]+/)) {
      if (/^-?[a-z][a-z0-9-]*$/.test(token) && !ANIMATION_KEYWORDS.has(token)) names.add(token);
    }
  }
  return names;
}

describe('styles.css', () => {
  test('使っているキーフレームはすべて定義してあり、定義したキーフレームはすべて使っている', () => {
    const defined = new Set([...css.matchAll(/@keyframes\s+([a-z0-9-]+)/g)].map((m) => m[1]));
    const used = referencedKeyframes();
    expect([...used].filter((n) => !defined.has(n))).toEqual([]);
    expect([...defined].filter((n) => n !== undefined && !used.has(n))).toEqual([]);
  });

  test('読んでいるカスタムプロパティは、CSS か、style を書く TypeScript のどちらかで値を与えている', () => {
    const definedInCss = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const missing = [...new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1] ?? ''))].filter(
      (name) => !definedInCss.has(name) && !tsSources.includes(`'${name}'`),
    );
    expect(missing).toEqual([]);
  });

  test('重なりの順は --z-* のトークンだけで決める', () => {
    expect(declarations(/z-index/).filter((v) => !/^var\(--z-[a-z]+\)$/.test(v))).toEqual([]);
  });
});
