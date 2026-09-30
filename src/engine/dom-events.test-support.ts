/** 入力のテストで使う、DOM のイベントと要素の代役 */

export function key(type: 'keydown' | 'keyup', k: string, extra: Record<string, unknown> = {}, target?: FakeElement): Event {
  const e = Object.assign(new Event(type, { cancelable: true }), { key: k, repeat: false, ...extra });
  // dispatchEvent が決める target の代わりに、フォーカスしている要素を届け先にする
  if (target) Object.defineProperty(e, 'target', { value: target });
  return e;
}

/** closest() だけを持つ要素の代役。`tag`・`[attr]`・`[attr="v"]`・`:not([attr="v"])` を並べた単純なセレクタだけ解釈する */
export class FakeElement {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly parent: FakeElement | null;

  constructor(tag: string, attrs: Record<string, string> = {}, parent: FakeElement | null = null) {
    this.tag = tag;
    this.attrs = attrs;
    this.parent = parent;
  }

  closest(selector: string): FakeElement | null {
    const parts = selector.split(',').map((s) => s.trim());
    if (parts.some((p) => this.matches(p))) return this;
    return this.parent?.closest(selector) ?? null;
  }

  private matches(sel: string): boolean {
    const m = /^([a-z]*)((?:\[[^\]]+\])*)((?::not\(\[[^\]]+\]\))*)$/.exec(sel);
    if (!m) throw new Error(`unsupported selector: ${sel}`);
    const [, tag, required, negated] = m;
    if (tag && tag !== this.tag) return false;
    const attrs = (s: string) => [...s.matchAll(/\[([a-z-]+)(?:="([^"]*)")?\]/g)].map((a) => ({ name: a[1], value: a[2] }));
    const has = (a: { name: string; value: string | undefined }) => a.name in this.attrs && (a.value === undefined || this.attrs[a.name] === a.value);
    return attrs(required).every(has) && !attrs(negated).some(has);
  }
}

