import { describe, expect, test } from 'bun:test';
import { RESULT_REVEAL as BREAKOUT } from './breakout/reveal.ts';
import { RESULT_REVEAL as REVERSI } from './reversi/reveal.ts';

describe('RESULT_REVEAL', () => {
  test.each([
    ['ブロック崩し', BREAKOUT],
    ['リバーシ', REVERSI],
  ])('%s: 操作を受け付け始めるのは、見出しが着地した後で、演出が終わる前', (_, reveal) => {
    expect(reveal.settleMs).toBeGreaterThanOrEqual(reveal.headingMs * 0.6);
    expect(reveal.settleMs).toBeLessThan(reveal.headingMs);
  });
});
