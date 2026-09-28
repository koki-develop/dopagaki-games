import { describe, expect, test } from 'bun:test';
import { isPlainClick } from './router.ts';
import type { ClickFacts } from './router.ts';

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
