/**
 * 開発ビルドでゲームのセッションが window に置く操作口（window.__breakout など）の置き場。
 * 開発ビルドの StrictMode では 2 つのセッションが同時に作られ、先に作った方が後から捨てられることがあるので、
 * 生きている操作口を積んでおき、捨てたときは残っているものへ戻す。
 * 操作口は、置いたセッション（owner）からも引ける（画面の調整パネルが使う）。
 * window がない環境（テスト）では、積むだけで window には置かない。
 */
export class DebugHookSlot<T extends object> {
  private readonly key: string;
  private readonly live: T[] = [];
  private readonly byOwner = new WeakMap<object, T>();

  /** @param key window に置くプロパティの名前 */
  constructor(key: string) {
    this.key = key;
  }

  /** owner の操作口として hooks を置く。owner がすでに置いていれば入れ替える */
  publish(owner: object, hooks: T): void {
    const prev = this.byOwner.get(owner);
    if (prev) this.live.splice(this.live.indexOf(prev), 1);
    this.byOwner.set(owner, hooks);
    this.live.push(hooks);
    this.write(hooks);
  }

  /** owner の操作口を取り除く。置いていなければ何もしない */
  unpublish(owner: object): void {
    const hooks = this.byOwner.get(owner);
    if (!hooks) return;
    this.byOwner.delete(owner);
    const i = this.live.indexOf(hooks);
    if (i >= 0) this.live.splice(i, 1);
    this.write(this.live[this.live.length - 1] ?? null);
  }

  /** owner が置いた操作口。置いていなければ null */
  of(owner: object): T | null {
    return this.byOwner.get(owner) ?? null;
  }

  private write(hooks: T | null): void {
    if (typeof window === 'undefined') return;
    const w = window as unknown as Record<string, unknown>;
    if (hooks) w[this.key] = hooks;
    else delete w[this.key];
  }
}
