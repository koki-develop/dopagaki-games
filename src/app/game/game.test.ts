import { describe, expect, test } from 'bun:test';
import { formatScore } from '../../shared/format.ts';
import { resultBestOf, resultBestText } from './result-best.ts';
import { countUpValue } from './useCountUp.ts';
import { keyGuard } from './useScreenGuards.ts';

describe('keyGuard', () => {
  const key = (k: string, repeat = false, onButton = false) => keyGuard({ key: k, repeat, onButton });

  test('Escape は押した 1 回だけ送る', () => {
    expect(key('Escape')).toBe('escape');
    expect(key('Escape', false, true)).toBe('escape');
    expect(key('Escape', true)).toBeNull();
  });

  test('ボタンの上での Enter と Space の自動の繰り返しだけを止める', () => {
    expect(key('Enter', true, true)).toBe('suppress');
    expect(key(' ', true, true)).toBe('suppress');
    expect(key('Enter', false, true)).toBeNull();
    expect(key(' ', false, true)).toBeNull();
    expect(key('Enter', true, false)).toBeNull();
    expect(key('ArrowLeft', true, true)).toBeNull();
  });
});

describe('countUpValue', () => {
  test('0 から始まり、長さの終わりで目標に届き、それより後も目標のまま', () => {
    expect(countUpValue(1000, -50, 800)).toBe(0);
    expect(countUpValue(1000, 0, 800)).toBe(0);
    expect(countUpValue(1000, 800, 800)).toBe(1000);
    expect(countUpValue(1000, 5000, 800)).toBe(1000);
  });

  test('減らずに増え、前半で大きく進む', () => {
    let prev = 0;
    for (let ms = 0; ms <= 800; ms += 10) {
      const v = countUpValue(1000, ms, 800);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(countUpValue(1000, 400, 800)).toBeGreaterThan(900);
  });

  test('長さが 0 なら最初から目標', () => {
    expect(countUpValue(42, 0, 0)).toBe(42);
  });
});

describe('resultBestOf', () => {
  test('更新したら NEW BEST!、しなかったら前の最高スコア、記録がなければ何も出さない', () => {
    expect(resultBestOf(true, 1200)).toEqual({ k: 'new' });
    expect(resultBestOf(true, 0)).toEqual({ k: 'new' });
    expect(resultBestOf(false, 1200)).toEqual({ k: 'previous', score: 1200 });
    expect(resultBestOf(false, 0)).toEqual({ k: 'none' });
  });

  test('読み上げは表示と同じ内容で、出さないときは空', () => {
    expect(resultBestText({ k: 'new' })).toBe('最高スコアを更新しました。');
    expect(resultBestText({ k: 'previous', score: 1200 })).toBe(`ベスト ${formatScore(1200)}。`);
    expect(resultBestText({ k: 'none' })).toBe('');
  });
});
