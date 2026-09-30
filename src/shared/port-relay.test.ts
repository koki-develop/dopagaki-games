import { describe, expect, test } from 'bun:test';
import { createPortRelay } from './port-relay.ts';

interface Port {
  start(level: number, name: string): void;
  stop(): void;
}

class Target implements Port {
  readonly log: string[] = [];
  start(level: number, name: string): void {
    this.log.push(`start ${level} ${name}`);
  }
  stop(): void {
    this.log.push('stop');
  }
}

describe('createPortRelay', () => {
  test('結びつけた相手へ命令をそのまま渡し、相手がいない間の命令は捨てる', () => {
    const relay = createPortRelay<Port>({ start: true, stop: true });
    relay.start(1, 'before');
    const a = new Target();
    relay.bind(a);
    relay.start(2, 'x');
    relay.stop();
    relay.bind(null);
    relay.stop();
    expect(a.log).toEqual(['start 2 x', 'stop']);
  });

  test('結びつけ直すと、新しい相手だけに渡す', () => {
    const relay = createPortRelay<Port>({ start: true, stop: true });
    const a = new Target();
    const b = new Target();
    relay.bind(a);
    relay.bind(b);
    relay.stop();
    expect(a.log).toEqual([]);
    expect(b.log).toEqual(['stop']);
  });
});
