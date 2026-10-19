import { describe, expect, test } from 'bun:test';
import { LoadError, startFailureCause } from './fatal.ts';

describe('startFailureCause', () => {
  test('データを読み込めなかったときは load、それ以外は描画を始められなかった init', () => {
    expect(startFailureCause(new LoadError('x'))).toBe('load');
    expect(startFailureCause(new Error('no gpu'))).toBe('init');
    expect(startFailureCause('?')).toBe('init');
  });
});
