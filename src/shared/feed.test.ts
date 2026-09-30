import { describe, expect, test } from 'bun:test';
import { EventFeed, LatestFeed } from './feed.ts';

describe('LatestFeed', () => {
  test('つないだ時点で最後の値を渡し、外した後は渡さない', () => {
    const feed = new LatestFeed<number>();
    feed.push(7);
    const got: number[] = [];
    const off = feed.connect((v) => got.push(v));
    feed.push(8);
    off();
    feed.push(9);
    expect(got).toEqual([7, 8]);
  });

  test('まだ値が届いていなければ、つないでも何も渡さない', () => {
    const feed = new LatestFeed<number>();
    const got: number[] = [];
    feed.connect((v) => got.push(v));
    expect(got).toEqual([]);
  });

  test('新しくつないだら、前の表示係には渡さない', () => {
    const feed = new LatestFeed<number>();
    const a: number[] = [];
    const b: number[] = [];
    const offA = feed.connect((v) => a.push(v));
    feed.connect((v) => b.push(v));
    feed.push(1);
    offA();
    feed.push(2);
    expect(a).toEqual([]);
    expect(b).toEqual([1, 2]);
  });
});

describe('EventFeed', () => {
  test('つないだ後に起きたものだけを渡し、外した後は渡さない', () => {
    const feed = new EventFeed<string>();
    feed.push('before');
    const got: string[] = [];
    const off = feed.connect((v) => got.push(v));
    feed.push('a');
    off();
    feed.push('b');
    expect(got).toEqual(['a']);
  });
});
