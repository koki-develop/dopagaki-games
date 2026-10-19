import { describe, expect, test } from 'bun:test';
import { Rng } from '../../../shared/rng.ts';
import { parseCard } from '../rules/cards.ts';
import type { Card } from '../rules/cards.ts';
import { Round } from '../rules/round.ts';
import { Shoe, SHOE_SIZE } from '../rules/shoe.ts';
import { basicAction } from './basic.ts';

const cards = (...names: string[]): Card[] => names.map(parseCard);
const ALL = { double: true, split: true };

/** ベーシックストラテジーで 1 ラウンドを打ち切る */
function playBasic(r: Round): void {
  while (r.active >= 0) {
    const h = r.hands[r.active];
    r.act(basicAction(h.cards, r.dealer[0], { double: r.can('double'), split: r.can('split') }));
  }
}

describe('ベーシックストラテジー', () => {
  test('表の代表的な場所（Wizard of Odds の 2 組・S17 の表と同じ）', () => {
    const up = (n: string) => parseCard(n);
    expect(basicAction(cards('10S', '2H'), up('2C'), ALL)).toBe('hit');
    expect(basicAction(cards('10S', '2H'), up('4C'), ALL)).toBe('stand');
    expect(basicAction(cards('10S', '6H'), up('10C'), ALL)).toBe('hit');
    expect(basicAction(cards('6S', '5H'), up('AC'), ALL)).toBe('double');
    expect(basicAction(cards('6S', '3H'), up('2C'), ALL)).toBe('double');
    expect(basicAction(cards('AS', '7H'), up('2C'), ALL)).toBe('stand');
    expect(basicAction(cards('AS', '7H'), up('4C'), ALL)).toBe('double');
    expect(basicAction(cards('AS', '7H'), up('4C'), { double: false, split: true })).toBe('stand');
    expect(basicAction(cards('AS', '7H'), up('AC'), ALL)).toBe('hit');
    expect(basicAction(cards('AS', '8H'), up('6C'), ALL)).toBe('stand');
    expect(basicAction(cards('7S', '7H'), up('8C'), ALL)).toBe('split');
    expect(basicAction(cards('6S', '6H'), up('7C'), ALL)).toBe('split');
    expect(basicAction(cards('4S', '4H'), up('4C'), ALL)).toBe('hit');
    expect(basicAction(cards('9S', '9H'), up('7C'), ALL)).toBe('stand');
    expect(basicAction(cards('2S', '2H'), up('2C'), ALL)).toBe('split');
    expect(basicAction(cards('2S', '2H'), up('8C'), ALL)).toBe('hit');
    expect(basicAction(cards('8S', '8H'), up('AC'), ALL)).toBe('split');
    expect(basicAction(cards('8S', '8H'), up('AC'), { double: true, split: false })).toBe('hit');
    expect(basicAction(cards('AS', 'AH'), up('6C'), { double: true, split: false })).toBe('hit');
  });

  test(
    'シューで打ち続けた期待値が、この規則で知られている値（-0.18%）に収まる',
    () => {
      // 2 組・S17・分けた後のダブルあり・4 つの手まで分け直せる（A は除く）・分けた A は 1 枚: Wizard of Odds の計算で -0.1779%
      const rng = new Rng(20261016);
      const ROUNDS = 1_000_000;
      // シューの 4 分の 3 まで配ったら、新しいシューに替える
      const PENETRATION = (SHOE_SIZE * 3) / 4;
      let shoe = Shoe.shuffled(rng);
      let net = 0;
      let sumSq = 0;
      for (let i = 0; i < ROUNDS; i++) {
        if (shoe.dealt >= PENETRATION) shoe = Shoe.shuffled(rng);
        const r = new Round(shoe, 100, 1e9);
        playBasic(r);
        const units = r.net / 100;
        net += units;
        sumSq += units * units;
        for (const h of r.hands) shoe.discard(h.cards);
        shoe.discard(r.dealer);
      }
      const mean = net / ROUNDS;
      const se = Math.sqrt((sumSq / ROUNDS - mean * mean) / ROUNDS);
      // 標準誤差の 3.5 倍以内（およそ ±0.4%）
      expect(Math.abs(mean - -0.001779)).toBeLessThan(3.5 * se);
      expect(se).toBeLessThan(0.0013);
    },
    { timeout: 60_000 },
  );
});
