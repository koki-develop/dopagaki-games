import { afterEach, describe, expect, test } from 'bun:test';
import { vibrate } from './haptics.ts';

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function stubNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'navigator', original);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

describe('vibrate', () => {
  test('Vibration API が無い環境では何もしない', () => {
    stubNavigator(undefined);
    expect(() => vibrate(10)).not.toThrow();
    stubNavigator({});
    expect(() => vibrate([10, 20])).not.toThrow();
  });

  test('ブラウザが拒否しても例外を出さない', () => {
    stubNavigator({
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    expect(() => vibrate(10)).not.toThrow();
  });

  test('ユーザーがまだ操作していなければ呼ばず、操作後は渡したパターンで振動させる', () => {
    const calls: unknown[] = [];
    const activation = { hasBeenActive: false };
    stubNavigator({ vibrate: (p: unknown) => calls.push(p), userActivation: activation });
    vibrate(10);
    expect(calls).toEqual([]);
    activation.hasBeenActive = true;
    vibrate([30, 40, 60]);
    expect(calls).toEqual([[30, 40, 60]]);
  });
});
