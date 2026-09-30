import { describe, expect, test } from 'bun:test';
import { DebugHookSlot } from './debug-hooks.ts';

describe('DebugHookSlot', () => {
  test('置いたセッションから引け、取り除くと引けなくなる', () => {
    const slot = new DebugHookSlot<{ id: string }>('__test');
    const owner = {};
    const hooks = { id: 'a' };
    slot.publish(owner, hooks);
    expect(slot.of(owner)).toBe(hooks);
    slot.unpublish(owner);
    expect(slot.of(owner)).toBeNull();
    expect(() => slot.unpublish(owner)).not.toThrow();
  });

  test('window がある環境では、最後に置いた操作口を置き、取り除いたら残っているものへ戻す', () => {
    const g = globalThis as { window?: unknown };
    const w: Record<string, unknown> = {};
    g.window = w;
    try {
      const slot = new DebugHookSlot<{ id: string }>('__test');
      const first = {};
      const second = {};
      slot.publish(first, { id: 'first' });
      slot.publish(second, { id: 'second' });
      expect(w.__test).toEqual({ id: 'second' });
      slot.unpublish(second);
      expect(w.__test).toEqual({ id: 'first' });
      slot.unpublish(first);
      expect('__test' in w).toBe(false);
    } finally {
      delete g.window;
    }
  });

  test('同じセッションが置き直したら、前の操作口と入れ替える', () => {
    const g = globalThis as { window?: unknown };
    const w: Record<string, unknown> = {};
    g.window = w;
    try {
      const slot = new DebugHookSlot<{ id: string }>('__test');
      const owner = {};
      slot.publish(owner, { id: 'old' });
      slot.publish(owner, { id: 'new' });
      expect(slot.of(owner)).toEqual({ id: 'new' });
      slot.unpublish(owner);
      // 前の操作口が残って window に戻らない
      expect('__test' in w).toBe(false);
    } finally {
      delete g.window;
    }
  });
});
