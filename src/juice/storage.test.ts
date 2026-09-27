import { afterEach, describe, expect, test } from 'bun:test';
import { safeLocalStorage } from './storage.ts';

const g = globalThis as { window?: unknown };

/** テストの間だけ window を差し替える */
const withWindow = (w: unknown): void => {
  g.window = w;
};

afterEach(() => {
  delete g.window;
});

describe('safeLocalStorage', () => {
  test('window がない環境では null', () => {
    expect(safeLocalStorage()).toBeNull();
  });

  test('localStorage がない、または触るだけで例外になるときは null', () => {
    withWindow({});
    expect(safeLocalStorage()).toBeNull();
    withWindow({
      get localStorage(): Storage {
        throw new Error('SecurityError');
      },
    });
    expect(safeLocalStorage()).toBeNull();
    withWindow({
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError');
        },
      },
    });
    expect(safeLocalStorage()).toBeNull();
  });

  test('使えるときはそのまま返し、確かめるときに書き込まない', () => {
    let writes = 0;
    const s = { getItem: () => null, setItem: () => void writes++ };
    withWindow({ localStorage: s });
    expect(safeLocalStorage()).toBe(s as unknown as Storage);
    expect(writes).toBe(0);
  });
});
