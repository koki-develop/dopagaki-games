import { describe, expect, test } from 'bun:test';
import { createRouter, isPlainClick } from './router.ts';
import type { ClickFacts, HistoryPort } from './router.ts';

/** 履歴の操作を記録する偽のブラウザ。pop で戻る・進むを起こす */
function fakeHistory(initial: string) {
  let path = initial;
  const log: string[] = [];
  const popListeners = new Set<() => void>();
  const port: HistoryPort = {
    pathname: () => path,
    pushState: (p) => {
      log.push(`push ${p}`);
      path = p;
    },
    scrollToTop: () => log.push('scroll'),
    onPopState: (l) => {
      popListeners.add(l);
      return () => popListeners.delete(l);
    },
  };
  const pop = (p: string) => {
    path = p;
    for (const l of popListeners) l();
  };
  return { port, log, pop, popListeners };
}

describe('createRouter', () => {
  test('いまのパスの画面を返す', () => {
    const h = fakeHistory('/breakout');
    const router = createRouter(h.port);
    expect(router.getRoute()).toBe('breakout');
    h.pop('/nope');
    expect(router.getRoute()).toBe('notFound');
  });

  test('ほかのページへは履歴を積み、先頭へスクロールしてから購読者へ知らせる', () => {
    const h = fakeHistory('/');
    const router = createRouter(h.port);
    const seen: string[] = [];
    router.subscribe(() => seen.push(router.getRoute()));
    router.navigate('breakout');
    expect(h.log).toEqual(['push /breakout', 'scroll']);
    expect(seen).toEqual(['breakout']);
  });

  test('いまと同じページへは何もしない', () => {
    const h = fakeHistory('/breakout');
    const router = createRouter(h.port);
    let calls = 0;
    router.subscribe(() => calls++);
    router.navigate('breakout');
    expect(h.log).toEqual([]);
    expect(calls).toBe(0);
  });

  test('戻る・進むを購読者へ知らせる。監視は購読者がいる間だけ 1 つ置く', () => {
    const h = fakeHistory('/');
    const router = createRouter(h.port);
    expect(h.popListeners.size).toBe(0);
    let a = 0;
    let b = 0;
    const offA = router.subscribe(() => a++);
    const offB = router.subscribe(() => b++);
    expect(h.popListeners.size).toBe(1);
    h.pop('/breakout');
    expect([a, b]).toEqual([1, 1]);
    offA();
    expect(h.popListeners.size).toBe(1);
    h.pop('/');
    expect([a, b]).toEqual([1, 2]);
    offB();
    expect(h.popListeners.size).toBe(0);
    router.subscribe(() => {});
    expect(h.popListeners.size).toBe(1);
  });
});

describe('isPlainClick', () => {
  const plain: ClickFacts = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

  test('修飾キーのない左クリックだけを横取りする', () => {
    expect(isPlainClick(plain)).toBe(true);
  });

  test('新しいタブやウィンドウで開く操作、止められたクリックはブラウザに任せる', () => {
    for (const facts of [
      { ...plain, button: 1 },
      { ...plain, button: 2 },
      { ...plain, metaKey: true },
      { ...plain, ctrlKey: true },
      { ...plain, shiftKey: true },
      { ...plain, altKey: true },
      { ...plain, defaultPrevented: true },
    ])
      expect(isPlainClick(facts)).toBe(false);
  });
});
