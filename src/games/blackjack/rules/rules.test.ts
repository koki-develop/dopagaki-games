import { describe, expect, test } from 'bun:test';
import { Rng } from '../../../shared/rng.ts';
import { cardCode, cardName, cardOf, DECK_SIZE, parseCard, pointOf, rankOf, Suit, suitOf } from './cards.ts';
import type { Card } from './cards.ts';
import { handValue, isNatural, isPair } from './hand.ts';
import { bustChance, DEALER_FINALS, dealerFinals, roundOdds, uncertainty } from './odds.ts';
import { DEALER, MAX_HANDS, Round } from './round.ts';
import type { RoundEvent } from './round.ts';
import { Shoe, SHOE_SIZE } from './shoe.ts';

/** 表記の列からカードの列 */
const cards = (...names: string[]): Card[] =>
  names.map((n) => {
    const c = parseCard(n);
    if (c < 0) throw new Error(`bad card ${n}`);
    return c;
  });

/** 表記の順に配るシューで、bet 100・手元 funds のラウンドを始める */
const roundOf = (names: string[], funds = 1000) => new Round(Shoe.ofOrder(cards(...names)), 100, funds);

/** 出来事の種類の列（配った先と、決着の結果を添える） */
const brief = (events: readonly RoundEvent[]): string[] =>
  events.map((e) => {
    switch (e.t) {
      case 'deal':
        return `deal ${e.hand === DEALER ? 'D' : e.hand}${e.faceUp ? '' : ' down'}`;
      case 'settle':
        return `settle ${e.hand} ${e.result} ${e.delta}`;
      case 'turn':
      case 'split':
      case 'double':
      case 'natural':
        return `${e.t} ${e.hand}`;
      case 'stand':
        return `stand ${e.hand} ${e.total}${e.auto ? ' auto' : ''}`;
      case 'bust':
        return `bust ${e.hand} ${e.total}`;
      case 'peek':
        return `peek ${e.blackjack}`;
      case 'dealerStand':
      case 'dealerBust':
        return `${e.t} ${e.total}`;
      default:
        return e.t;
    }
  });

describe('カード', () => {
  test('番号はスートごとに A〜K の順で、点は A が 1、絵札が 10', () => {
    expect([rankOf(0), suitOf(0), pointOf(0)]).toEqual([0, Suit.Spade, 1]);
    expect([rankOf(cardOf(Suit.Club, 12)), suitOf(cardOf(Suit.Club, 12)), pointOf(cardOf(Suit.Club, 12))]).toEqual([12, Suit.Club, 10]);
    expect(cards('10H', 'JH', 'QH', 'KH').map(pointOf)).toEqual([10, 10, 10, 10]);
  });

  test('表記を読み、読み上げの名前にする', () => {
    expect(parseCard('AS')).toBe(cardOf(Suit.Spade, 0));
    expect(parseCard('10d')).toBe(cardOf(Suit.Diamond, 9));
    expect([parseCard('1S'), parseCard('AX'), parseCard('')]).toEqual([-1, -1, -1]);
    expect(cardName(parseCard('QH'))).toBe('ハートの Q');
  });

  test('表記にして読み直すと、どのカードも同じカードに戻る', () => {
    expect([cardCode(parseCard('10H')), cardCode(parseCard('KC'))]).toEqual(['10H', 'KC']);
    for (let c = 0; c < DECK_SIZE; c++) expect(parseCard(cardCode(c))).toBe(c);
  });
});

describe('手の合計', () => {
  test('A は 21 を超えない限り 1 枚を 11 と数え、そのときはソフト', () => {
    expect(handValue(cards('AS', '6H'))).toEqual({ total: 17, soft: true });
    expect(handValue(cards('AS', '6H', '9C'))).toEqual({ total: 16, soft: false });
    expect(handValue(cards('AS', 'AH', '9C'))).toEqual({ total: 21, soft: true });
    expect(handValue(cards('KS', 'QH', '5C'))).toEqual({ total: 25, soft: false });
  });

  test('ブラックジャックは最初の 2 枚の 21。ペアは同じ点の 2 枚', () => {
    expect(isNatural(cards('AS', 'KD'))).toBe(true);
    expect(isNatural(cards('7S', '7D', '7C'))).toBe(false);
    expect(isPair(cards('10S', 'KD'))).toBe(true);
    expect(isPair(cards('9S', '10D'))).toBe(false);
  });
});

describe('シュー', () => {
  test('2 組を混ぜ、どのカードもちょうど 2 枚ずつある', () => {
    const shoe = Shoe.shuffled(new Rng(7));
    const seen = new Map<Card, number>();
    for (let i = 0; i < SHOE_SIZE; i++) {
      const c = shoe.draw();
      seen.set(c, (seen.get(c) ?? 0) + 1);
    }
    expect(seen.size).toBe(52);
    expect([...seen.values()].every((n) => n === 2)).toBe(true);
    expect([...shoe.remainingByPoint]).toEqual(new Array(10).fill(0));
  });

  test('同じ種なら同じ順に配る', () => {
    const a = Shoe.shuffled(new Rng(99));
    const b = Shoe.shuffled(new Rng(99));
    for (let i = 0; i < 20; i++) expect(a.draw()).toBe(b.draw());
  });

  test('残りの数を点ごとに数える', () => {
    const shoe = Shoe.shuffled(new Rng(1));
    expect(shoe.remainingByPoint[9]).toBe(32);
    let tens = 32;
    for (let i = 0; i < 40; i++) if (pointOf(shoe.draw()) === 10) tens--;
    expect([shoe.remainingByPoint[9], shoe.dealt, shoe.remaining]).toEqual([tens, 40, SHOE_SIZE - 40]);
  });

  test('先頭に決めたカードを置き、残りの構成は 2 組のまま', () => {
    const top = cards('AS', 'AS', 'KD');
    const shoe = Shoe.withTop(top, new Rng(3));
    expect([shoe.draw(), shoe.draw(), shoe.draw()]).toEqual(top);
    expect(shoe.remaining).toBe(SHOE_SIZE - 3);
    expect(() => Shoe.withTop(cards('AS', 'AS', 'AS'), new Rng(3))).toThrow();
  });

  test('尽きたら、捨てたカードを混ぜ直して配る', () => {
    const shoe = Shoe.ofOrder(cards('2S', '3S'));
    shoe.draw();
    shoe.draw();
    shoe.discard(cards('9H', '8H'));
    expect([shoe.draw(), shoe.draw(), shoe.reshuffles]).toEqual([...cards('9H', '8H'), 1]);
    expect(() => shoe.draw()).toThrow();
  });
});

describe('確率', () => {
  test('バーストする確率は、超えるカードの枚数の割合', () => {
    const unseen = new Int32Array(10).fill(4);
    unseen[9] = 16;
    // 合計 12（A を 1 と数えて）に 10 点のカードで超える: 16 / 52
    expect(bustChance(12, unseen)).toBeCloseTo(16 / 52, 12);
    expect(bustChance(11, unseen)).toBe(0);
    expect(bustChance(21, unseen)).toBe(1);
    expect(bustChance(15, new Int32Array(10))).toBe(0);
  });

  test('ディーラーの結果の確率は足して 1 で、引いて確かめた割合と合う', () => {
    const shoe = Shoe.shuffled(new Rng(5));
    const unseen = Int32Array.from(shoe.remainingByPoint);
    // 6 を見せている（1 枚取り除く）
    unseen[5]--;
    const finals = dealerFinals(6, false, unseen, 0, new Float64Array(DEALER_FINALS));
    expect(finals.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const rng = new Rng(11);
    const counts = new Array(DEALER_FINALS).fill(0);
    const N = 100_000;
    for (let i = 0; i < N; i++) {
      const pool = Array.from(unseen);
      let hard = 6;
      let ace = false;
      for (;;) {
        const total = ace && hard + 10 <= 21 ? hard + 10 : hard;
        if (hard > 21) {
          counts[5]++;
          break;
        }
        if (total >= 17) {
          counts[total - 17]++;
          break;
        }
        let r = Math.floor(rng.next() * pool.reduce((a, b) => a + b, 0));
        let p = 0;
        while (r >= pool[p]) r -= pool[p++];
        pool[p]--;
        hard += p + 1;
        ace ||= p === 0;
      }
    }
    for (let k = 0; k < DEALER_FINALS; k++) expect(Math.abs(counts[k] / N - finals[k])).toBeLessThan(0.006);
    // 6 を見せたディーラーは 4 割ほどバーストする
    expect(finals[5]).toBeGreaterThan(0.39);
    expect(finals[5]).toBeLessThan(0.45);
  });

  test('ブラックジャックでないと確かめた後は、伏せたカードからその点を除く', () => {
    const unseen = new Int32Array(10).fill(8);
    unseen[9] = 32;
    const peeked = dealerFinals(1, true, unseen, 10, new Float64Array(DEALER_FINALS));
    expect(peeked.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    // 伏せたカードが 10 点でないので、すぐに 21 になることはなく、21 の割合は 10 点を含めた場合より小さい
    const unpeeked = dealerFinals(1, true, unseen, 0, new Float64Array(DEALER_FINALS));
    expect(peeked[4]).toBeLessThan(unpeeked[4]);
  });

  test('ラウンドに勝つ確率は、ディーラーの結果ごとの増減の合計から', () => {
    const finals = new Float64Array([0.2, 0.2, 0.2, 0.2, 0, 0.2]);
    // 19 の手 1 つ: 17・18 とバーストで勝ち、19 は引き分け、20 で負け
    expect(roundOdds([{ total: 19, bet: 100, settled: null }], finals)).toEqual({ win: 0.6000000000000001, lose: 0.2 });
    // バーストした手（-100）と 19 の手: 勝つ場面でも差し引き 0
    const both = roundOdds(
      [
        { total: 25, bet: 100, settled: -100 },
        { total: 19, bet: 100, settled: null },
      ],
      finals,
    );
    expect(both.win).toBe(0);
    expect(both.lose).toBeCloseTo(0.4, 12);
    expect([uncertainty(0), uncertainty(0.5), uncertainty(1)]).toEqual([0, 1, 0]);
  });
});

describe('ラウンド', () => {
  test('プレイヤー → ディーラー（表）→ プレイヤー → ディーラー（伏せる）の順に配り、最初の手の操作を待つ', () => {
    const r = roundOf(['10S', '7H', '6D', '9C']);
    expect(brief(r.events)).toEqual(['deal 0', 'deal D', 'deal 0', 'deal D down', 'turn 0']);
    expect([r.active, r.can('hit'), r.can('double'), r.can('split')]).toEqual([0, true, true, false]);
  });

  test('止めると、ディーラーは 17 以上になるまで引き、ソフト 17 で止まる', () => {
    const r = roundOf(['10S', '6H', '9D', 'KC', 'AS']);
    r.act('stand');
    // ディーラー 6 + K = 16 → A で ソフト 17 → 止まる。プレイヤー 19 の勝ち
    expect(brief(r.events).slice(5)).toEqual(['stand 0 19', 'reveal', 'deal D', 'dealerStand 17', 'settle 0 win 100', 'end']);
    expect([r.finished, r.net]).toEqual([true, 100]);
  });

  test('引いて 21 を超えたらその場で負けが決まり、ディーラーは表にするだけで引かない', () => {
    const r = roundOf(['10S', '6H', '6D', '5C', 'KH']);
    r.act('hit');
    expect(brief(r.events).slice(5)).toEqual(['deal 0', 'bust 0 26', 'settle 0 lose -100', 'reveal', 'end']);
    expect(r.dealer.length).toBe(2);
  });

  test('引いて 21 になったら止める', () => {
    const r = roundOf(['5S', '9H', '6D', '8C', 'KH', '10D']);
    r.act('hit');
    expect(brief(r.events).slice(5, 7)).toEqual(['deal 0', 'stand 0 21 auto']);
    expect(r.hands[0].result).toBe('win');
  });

  test('プレイヤーのブラックジャックは 3:2 で、ディーラーは引かない', () => {
    const r = roundOf(['AS', '6H', 'KD', '9C']);
    expect(brief(r.events)).toEqual(['deal 0', 'deal D', 'deal 0', 'deal D down', 'natural 0', 'settle 0 blackjack 150', 'reveal', 'end']);
    expect(r.net).toBe(150);
  });

  test('A を見せたディーラーは伏せたカードを確かめ、ブラックジャックならすぐに精算する', () => {
    const lose = roundOf(['10S', 'AH', '9D', 'KC']);
    expect(brief(lose.events).slice(4)).toEqual(['peek true', 'reveal', 'dealerNatural', 'settle 0 lose -100', 'end']);
    const push = roundOf(['AS', 'AH', 'QD', 'KC']);
    expect(brief(push.events).slice(4)).toEqual(['peek true', 'reveal', 'dealerNatural', 'natural 0', 'settle 0 push 0', 'end']);
    const miss = roundOf(['10S', 'KH', '9D', '7C']);
    expect(brief(miss.events).slice(4)).toEqual(['peek false', 'turn 0']);
  });

  test('ダブルは賭けを倍にして 1 枚だけ引いて止める', () => {
    const r = roundOf(['6S', '9H', '5D', '7C', 'KH', '8D']);
    r.act('double');
    // 21 で止め、ディーラー 16 → 8 でバースト
    expect(brief(r.events).slice(5)).toEqual(['double 0', 'deal 0', 'stand 0 21 auto', 'reveal', 'deal D', 'dealerBust 24', 'settle 0 win 200', 'end']);
    expect([r.committed, r.hands[0].bet]).toEqual([200, 200]);
  });

  test('分けると 2 枚目を新しい手にし、左の手から 2 枚目を配る。分けた手の 21 はブラックジャックではない', () => {
    const r = roundOf(['8S', '9H', '8D', '7C', 'AH', '3C', 'KS', '4D']);
    r.act('split');
    // 左: 8 + A = 19（ソフト）
    expect(brief(r.events).slice(5)).toEqual(['split 0', 'deal 0', 'turn 0']);
    r.act('stand');
    // 右: 8 + 3 = 11 → ダブルできる
    expect(brief(r.events).slice(8)).toEqual(['stand 0 19', 'deal 1', 'turn 1']);
    expect(r.can('double')).toBe(true);
    r.act('double');
    // 11 + K = 21（ブラックジャックではない）。ディーラーは 16 から 4 を引いて 20
    expect(r.hands[1].cards.length).toBe(3);
    expect(r.hands.map((h) => h.result)).toEqual(['lose', 'win']);
    expect(r.net).toBe(100);
    expect(r.hands.map((h) => h.fromSplit)).toEqual([true, true]);
  });

  test('A を分けると 1 枚ずつ配って止め、分け直せない', () => {
    const r = roundOf(['AS', '9H', 'AD', '7C', 'AH', 'KC', 'KS']);
    r.act('split');
    expect(brief(r.events).slice(5, 10)).toEqual(['split 0', 'deal 0', 'deal 1', 'stand 0 12 auto', 'stand 1 21 auto']);
    expect(r.hands[1].result).toBe('win');
    expect(r.hands[1].delta).toBe(100);
  });

  test('4 つの手まで分け直せる', () => {
    const r = roundOf(['8S', '9H', '8D', '7C', '8H', '8C', '8S', '2D', '2H', '2C', '2S', 'KD', 'KD', 'KD', 'KD'], 10_000);
    r.act('split');
    r.act('split');
    r.act('split');
    expect(r.hands.length).toBe(MAX_HANDS);
    expect(r.can('split')).toBe(false);
  });

  test('手元のチップが足りなければダブルも分けることもできない', () => {
    const r = roundOf(['8S', '9H', '8D', '7C'], 99);
    expect([r.can('double'), r.can('split'), r.can('hit')]).toEqual([false, false, true]);
    expect(() => r.act('double')).toThrow();
  });

  test('プレイヤーが選んで引いた 1 枚には chosen が付く', () => {
    const r = roundOf(['8S', '9H', '8D', '7C', '2H', '3C', 'KS', '4D']);
    r.act('split');
    r.act('hit');
    const chosen = r.events.flatMap((e) => (e.t === 'deal' ? [e.chosen] : []));
    // 配った 4 枚、分けた左の 2 枚目、引いた 1 枚
    expect(chosen).toEqual([false, false, false, false, false, true]);
  });

  test('ラウンドの途中でシューが尽きたら、捨てたカードを混ぜ直したことを配る前に知らせる', () => {
    const shoe = Shoe.ofOrder(cards('10S', '6H', '6D', '5C'));
    shoe.discard(cards('2S', '3H'));
    const r = new Round(shoe, 100, 1000);
    r.act('hit');
    expect(brief(r.events).slice(5, 7)).toEqual(['reshuffle', 'deal 0']);
    const e = r.events[5];
    expect(e.t === 'reshuffle' && [...e.remaining]).toEqual([0, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
  });
});
