import { describe, expect, test } from 'bun:test';
import { formatScore, formatSigned } from './format.ts';

describe('formatScore', () => {
  test('3 桁ごとにカンマで区切る', () => {
    expect([0, 7, 999, 1000, 12345, 123456, 1234567].map(formatScore)).toEqual(['0', '7', '999', '1,000', '12,345', '123,456', '1,234,567']);
    expect(formatScore(123_456_789_012)).toBe('123,456,789,012');
  });

  test('小数は切り捨て、負の値は 0 にする', () => {
    expect(formatScore(1999.9)).toBe('1,999');
    expect(formatScore(-5)).toBe('0');
  });
});

describe('formatSigned', () => {
  test('増えたら +、減ったら - を付けて 3 桁ごとに区切り、0 は符号を付けない', () => {
    expect([1250, -300, 0, 1_000_000, -0.4, 99.9].map(formatSigned)).toEqual(['+1,250', '-300', '0', '+1,000,000', '0', '+99']);
  });
});
