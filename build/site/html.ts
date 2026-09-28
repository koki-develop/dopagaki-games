/** HTML の本文と属性値に入れる文字列をエスケープする */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** <meta> や <link> のように閉じタグのない要素。属性は並べた順に書く */
export function voidTag(name: string, attrs: Readonly<Record<string, string>>): string {
  const rendered = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
    .join('');
  return `<${name}${rendered}>`;
}

/** 文字列がちょうど 1 回だけ現れる前提で置き換える。テンプレートの形が想定と違えば、黙って壊さずにエラーにする */
export function replaceOnce(html: string, pattern: RegExp, replacer: (match: string, ...groups: string[]) => string): string {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const count = [...html.matchAll(global)].length;
  if (count !== 1) throw new Error(`expected exactly one match for ${pattern} in index.html, found ${count}`);
  return html.replace(pattern, replacer);
}
