import { describe, expect, test } from 'bun:test';
import { Rng } from '../../../shared/rng.ts';
import { basicAction } from '../strategy/basic.ts';
import { parseCard } from './cards.ts';
import type { Card } from './cards.ts';
import { totalOf } from './hand.ts';
import { Fortune } from './fortune.ts';
import type { FortuneTuning } from './fortune.ts';
import { Round } from './round.ts';
import { Shoe, SHOE_SIZE } from './shoe.ts';

const cards = (...names: string[]): Card[] => names.map(parseCard);
const ALWAYS: FortuneTuning = { lookahead: 6, bust: 1, dealerNatural: 1, dealerWin: 1 };
const NEVER: FortuneTuning = { lookahead: 6, bust: 0, dealerNatural: 0, dealerWin: 0 };

/** 表記の順に配るシューで、tuning の幸運を付けたラウンドを始める */
const roundOf = (names: string[], tuning: FortuneTuning) =>
  new Round(Shoe.ofOrder(cards(...names)), 100, 1000, new Fortune(new Rng(1), tuning));

describe('Shoe の先読みと入れ替え', () => {
  test('入れ替えても残りのカードの構成は変わらず、残っていない位置は -1', () => {
    const shoe = Shoe.ofOrder(cards('KS', '4H', '9C'));
    const before = Array.from(shoe.remainingByPoint);
    shoe.swapNext(2);
    expect([shoe.peek(0), shoe.peek(1), shoe.peek(2), shoe.peek(3)]).toEqual([...cards('9C', '4H', 'KS'), -1]);
    expect(Array.from(shoe.remainingByPoint)).toEqual(before);
    expect(() => shoe.swapNext(3)).toThrow();
    expect(() => shoe.swapNext(0)).toThrow();
  });
});

describe('Fortune', () => {
  // プレイヤー 10・6、ディーラー 9（表）・7（伏せ）。次は K（バースト）、9（バースト）、4
  const HIT = ['10S', '9H', '6S', '7H', 'KC', '9D', '4C', '2S', '2H'];

  test('選んで引いた 1 枚でバーストするとき、すぐ後ろのバーストしない最初のカードと入れ替える', () => {
    const r = roundOf(HIT, ALWAYS);
    r.act('hit');
    expect(totalOf(r.hands[0].cards)).toBe(20);
    expect(r.hands[0].status).toBe('playing');
  });

  test('確率に当たらなければ、配る順のまま', () => {
    const r = roundOf(HIT, NEVER);
    r.act('hit');
    expect(r.hands[0].status).toBe('bust');
  });

  test('すぐ後ろにバーストしないカードがなければ、入れ替えない', () => {
    const r = roundOf(HIT, { ...ALWAYS, lookahead: 1 });
    r.act('hit');
    expect(r.hands[0].status).toBe('bust');
  });

  test('バーストしない 1 枚は入れ替えない（ニアミスも作らない）', () => {
    // 次の 5 では 21 にならないが、痛くないので、後ろの 5 と入れ替えて 21 にすることもしない
    const r = roundOf(['10S', '9H', '6S', '7H', '2C', '5D', '2S', '2H'], ALWAYS);
    r.act('hit');
    expect(r.hands[0].cards).toEqual(cards('10S', '6S', '2C'));
  });

  test('ディーラーの伏せたカードがブラックジャックを作るときは、作らないカードと入れ替える', () => {
    const r = roundOf(['10S', 'AH', '8S', 'KD', '7C', '2S', '2H'], ALWAYS);
    expect(r.dealer).toEqual(cards('AH', '7C'));
    expect(r.events.some((e) => e.t === 'dealerNatural')).toBe(false);
  });

  test('ディーラーの引く 1 枚が止めた手に勝つときは、勝たないカードと入れ替える', () => {
    // プレイヤー 18 で止める。ディーラー 10・6 の次は 3（19 で勝つ）、2（18 で引き分け）
    const r = roundOf(['10S', '10H', '8S', '6D', '3C', '2D', '2S', '2H'], ALWAYS);
    r.act('stand');
    expect(totalOf(r.dealer)).toBe(18);
    expect(r.hands[0].result).toBe('push');
  });

  test(
    '毎回同じ額をベーシックストラテジーで賭けると、勝ちと負けのラウンドの割合がほぼ入れ替わり、バーストもディーラーのブラックジャックも起き続ける',
    () => {
      const N = 200_000;
      const play = (fortune: Fortune | null) => {
        const rng = new Rng(20261018);
        let shoe = Shoe.shuffled(rng);
        let win = 0;
        let lose = 0;
        let busts = 0;
        let naturals = 0;
        for (let i = 0; i < N; i++) {
          if (shoe.dealt >= (SHOE_SIZE * 3) / 4) shoe = Shoe.shuffled(rng);
          const r = new Round(shoe, 100, 1e9, fortune);
          while (r.active >= 0) {
            const h = r.hands[r.active];
            r.act(basicAction(h.cards, r.dealer[0], { double: r.can('double'), split: r.can('split') }));
          }
          if (r.net > 0) win++;
          else if (r.net < 0) lose++;
          for (const e of r.events) {
            if (e.t === 'bust') busts++;
            if (e.t === 'dealerNatural') naturals++;
          }
        }
        return { win: win / N, lose: lose / N, busts: busts / N, naturals: naturals / N };
      };
      const base = play(null);
      const lucky = play(new Fortune(new Rng(7)));
      expect(base.lose - base.win).toBeGreaterThan(0.035);
      expect(lucky.win - lucky.lose).toBeGreaterThan(0.01);
      expect(lucky.win - lucky.lose).toBeLessThan(0.04);
      expect(lucky.busts / base.busts).toBeGreaterThan(0.85);
      expect(lucky.naturals / base.naturals).toBeGreaterThan(0.75);
    },
    { timeout: 60_000 },
  );
});
