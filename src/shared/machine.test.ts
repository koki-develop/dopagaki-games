import { describe, expect, test } from 'bun:test';
import { createMachineStore } from './machine.ts';
import type { Transition } from './machine.ts';

type S = { n: number; failed: boolean };
type E = { t: 'add'; by: number } | { t: 'noop' } | { t: 'fail' };
type C = { c: 'log'; text: string } | { c: 'boom' };

const transition = (s: S, e: E): Transition<S, C> => {
  switch (e.t) {
    case 'add':
      return { state: { ...s, n: s.n + e.by }, commands: [{ c: 'log', text: `add ${e.by}` }] };
    case 'noop':
      return { state: s, commands: [] };
    case 'fail':
      return { state: { ...s, failed: true }, commands: [] };
  }
};

describe('createMachineStore', () => {
  test('遷移した状態を返し、命令を 1 回ずつ実行する', () => {
    const log: string[] = [];
    const store = createMachineStore<S, E, C>({
      initial: { n: 0, failed: false },
      transition,
      execute: (c) => void (c.c === 'log' && log.push(c.text)),
      failed: () => null,
    });
    store.dispatch({ t: 'add', by: 2 });
    store.dispatch({ t: 'add', by: 3 });
    expect(store.getSnapshot().n).toBe(5);
    expect(log).toEqual(['add 2', 'add 3']);
  });

  test('状態が変わらないイベントでは知らせない', () => {
    const store = createMachineStore<S, E, C>({ initial: { n: 0, failed: false }, transition, execute: () => {}, failed: () => null });
    let notified = 0;
    store.subscribe(() => notified++);
    store.dispatch({ t: 'noop' });
    expect(notified).toBe(0);
    store.dispatch({ t: 'add', by: 1 });
    expect(notified).toBe(1);
  });

  test('命令の実行中に届いたイベントは、その後で処理する', () => {
    const order: string[] = [];
    let reenter = true;
    const store = createMachineStore<S, E, C>({
      initial: { n: 0, failed: false },
      transition,
      execute: (c) => {
        if (c.c !== 'log') return;
        order.push(`${c.text} begin`);
        if (reenter) {
          reenter = false;
          store.dispatch({ t: 'add', by: 10 });
        }
        order.push(`${c.text} end`);
      },
      failed: () => null,
    });
    store.dispatch({ t: 'add', by: 1 });
    expect(order).toEqual(['add 1 begin', 'add 1 end', 'add 10 begin', 'add 10 end']);
    expect(store.getSnapshot().n).toBe(11);
  });

  test('命令が失敗したら残りの命令を捨て、返したイベントを後で処理する', () => {
    const ran: string[] = [];
    const store = createMachineStore<S, E, C>({
      initial: { n: 0, failed: false },
      transition: (s, e) => (e.t === 'add' ? { state: s, commands: [{ c: 'boom' }, { c: 'log', text: 'after' }] } : transition(s, e)),
      execute: (c) => {
        if (c.c === 'boom') throw new Error('boom');
        ran.push(c.text);
      },
      failed: (_e, s) => (s.failed ? null : { t: 'fail' }),
    });
    store.dispatch({ t: 'add', by: 1 });
    expect(ran).toEqual([]);
    expect(store.getSnapshot().failed).toBe(true);
  });

  test('外した購読者には知らせない', () => {
    const store = createMachineStore<S, E, C>({ initial: { n: 0, failed: false }, transition, execute: () => {}, failed: () => null });
    let notified = 0;
    const off = store.subscribe(() => notified++);
    off();
    store.dispatch({ t: 'add', by: 1 });
    expect(notified).toBe(0);
  });

  test('transition が例外を投げたら、処理していないイベントを捨てる。次の dispatch に持ち越さない', () => {
    const log: string[] = [];
    let throwOnAdd = true;
    const store = createMachineStore<S, E, C>({
      initial: { n: 0, failed: false },
      transition: (s, e) => {
        if (e.t === 'add' && e.by === 1 && throwOnAdd) throw new Error('bad');
        return transition(s, e);
      },
      execute: (c) => {
        if (c.c === 'log') {
          log.push(c.text);
          // 命令の実行中に届いたイベントは後で処理する
          if (c.text === 'add 2') {
            store.dispatch({ t: 'add', by: 1 });
            store.dispatch({ t: 'add', by: 5 });
          }
        }
      },
      failed: () => null,
    });
    expect(() => store.dispatch({ t: 'add', by: 2 })).toThrow('bad');
    throwOnAdd = false;
    store.dispatch({ t: 'add', by: 10 });
    expect(log).toEqual(['add 2', 'add 10']);
    expect(store.getSnapshot().n).toBe(12);
  });
});
