import { describe, expect, test } from 'bun:test';
import { Rng } from '../../shared/rng.ts';
import { parseCard } from './rules/cards.ts';
import { Shoe } from './rules/shoe.ts';
import { CHIP_VALUES, chipShare, chipStack, MAX_STACK, RACK_COLUMNS, rackColumns, rackStacks } from './denominations.ts';
import { betLimit, fitBet, isValidBet, MIN_BET, payoutOf, ROUNDS, START_CHIPS } from './scoring.ts';
import { feverLevel, multiplierTenths, Streak, STREAK } from './streak.ts';
import { Table } from './table.ts';
import { basicAction } from './strategy/basic.ts';

/** 表記の順に配るシュー */
const shoeOf = (names: string[]) => Shoe.ofOrder(names.map(parseCard));
const BET = 100;

/** 勝つラウンド（プレイヤー 20 対ディーラー 17、止める）の 4 枚 */
const WIN = ['10S', '10H', 'QD', '7C'];
/** 負けるラウンド（プレイヤー 17 対ディーラー 20、止める） */
const LOSE = ['10S', '10H', '7D', 'QC'];

describe('連勝', () => {
  test('勝ちで積み、負けで途切れ、引き分けでは変わらない', () => {
    const s = new Streak();
    expect(s.record(100)).toEqual({ before: 0, after: 1, broken: false });
    expect(s.record(0)).toEqual({ before: 1, after: 1, broken: false });
    expect(s.record(150)).toEqual({ before: 1, after: 2, broken: false });
    expect(s.record(-100)).toEqual({ before: 2, after: 0, broken: true });
    expect(s.record(-100)).toEqual({ before: 0, after: 0, broken: false });
    expect(s.best).toBe(2);
  });

  test('倍率は連勝 1 で ×1 から 0.5 ずつ上がり、×5 で止まる。フィーバーは連勝 3 から', () => {
    expect([1, 2, 3, 9, 20].map(multiplierTenths)).toEqual([10, 15, 20, 50, 50]);
    expect([feverLevel(STREAK.feverStart - 1), feverLevel(STREAK.feverStart) > 0, feverLevel(STREAK.feverFull)]).toEqual([0, true, 1]);
  });
});

describe('払い戻し', () => {
  test('勝ったラウンドは、勝った手の分に倍率の上乗せを足す。負けた手には掛けない', () => {
    expect(payoutOf([150], 2)).toEqual({ net: 150, won: 150, lost: 0, multiplierTenths: 15, bonus: 75, total: 225 });
    expect(payoutOf([200, -100], 3)).toEqual({ net: 100, won: 200, lost: 100, multiplierTenths: 20, bonus: 200, total: 300 });
  });

  test('上乗せの端数は、いちばん小さいチップ（5）の倍数に切り捨てる', () => {
    // ブラックジャック 15 × 0.5 = 7.5 → 5
    expect(payoutOf([15], 2)).toMatchObject({ bonus: 5, total: 20 });
    expect(payoutOf([30], 2)).toMatchObject({ bonus: 15, total: 45 });
  });

  test('差し引き 0 や負けたラウンドには上乗せがない', () => {
    expect(payoutOf([100, -100], 5)).toEqual({ net: 0, won: 100, lost: 100, multiplierTenths: 10, bonus: 0, total: 0 });
    expect(payoutOf([-200], 0).total).toBe(-200);
  });
});

describe('賭けの決まり', () => {
  test('賭けは 10 の倍数で、10 から手持ちまで（上限はない）', () => {
    expect([isValidBet(10, 1000), isValidBet(15, 1000), isValidBet(0, 1000), isValidBet(1010, 1000), isValidBet(1000, 1000)]).toEqual([true, false, false, false, true]);
    expect([betLimit(1005), betLimit(5_000_005), betLimit(9)]).toEqual([1000, 5_000_000, 0]);
    expect(isValidBet(2_500_000, 3_000_000)).toBe(true);
  });

  test('前の賭けを、今の手持ちで賭けられる値へ収める', () => {
    expect([fitBet(300, 1000), fitBet(300, 250), fitBet(5, 1000), fitBet(300, 9), fitBet(200_000, 99_999)]).toEqual([300, 250, MIN_BET, 0, 99_990]);
  });
});

describe('チップの額面', () => {
  test('額を大きい額面から崩す。払い戻しに出てくる額はどれも崩しきれる', () => {
    const out: number[] = [];
    expect(chipStack(1635, out).map((d) => CHIP_VALUES[d])).toEqual([1000, 500, 100, 25, 10]);
    let most = 0;
    // 20,000 までの 5 の倍数は、MAX_STACK 枚までで崩しきれる
    for (let a = 5; a <= 20_000; a += 5) {
      const stack = chipStack(a, out);
      expect(stack.reduce((sum, d) => sum + CHIP_VALUES[d], 0)).toBe(a);
      most = Math.max(most, stack.length);
    }
    expect(most).toBeLessThanOrEqual(MAX_STACK);
  });

  test('崩すと MAX_STACK 枚を超える額は、大きい額面から MAX_STACK 枚だけ積み、いちばん上のチップが残りの額を運ぶ', () => {
    const out: number[] = [];
    for (const a of [99_995, 123_455, 2_500_000]) {
      const stack = chipStack(a, out);
      expect(stack.length).toBe(MAX_STACK);
      expect(stack.every((d, k) => k === 0 || CHIP_VALUES[d] <= CHIP_VALUES[stack[k - 1]])).toBe(true);
      let sum = 0;
      for (let n = 0; n < stack.length; n++) sum += chipShare(stack, a, n);
      expect(sum).toBe(a);
    }
    // 積みきれる額では、どのチップも額面の額を運ぶ
    const small = chipStack(1635, out);
    expect(small.map((_d, n) => chipShare(small, 1635, n))).toEqual([1000, 500, 100, 25, 10]);
  });
});

describe('手持ちのチップの山', () => {
  const rack = new Int32Array(CHIP_VALUES.length);
  const value = (counts: Int32Array) => counts.reduce((sum, n, d) => sum + n * CHIP_VALUES[d], 0);
  const shown = (counts: Int32Array) => Object.fromEntries([...counts].flatMap((n, d) => (n > 0 ? [[CHIP_VALUES[d], n]] : [])));

  test('500 以上のチップを、10 枚ずつの列が 7 列に収まる間だけ 1 つ下の額面へ崩す', () => {
    expect(shown(rackStacks(1000, rack))).toEqual({ 100: 10 });
    expect(shown(rackStacks(2350, rack))).toEqual({ 100: 23, 25: 2 });
    expect(shown(rackStacks(5000, rack))).toEqual({ 100: 50 });
    expect(shown(rackStacks(20_000, rack))).toEqual({ 500: 34, 100: 30 });
    expect(shown(rackStacks(0, rack))).toEqual({});
  });

  test('5,000 が 10 枚までの手持ちは、山の額が手持ちと同じ。どの手持ちも 7 列に収まる', () => {
    for (let a = 0; a <= 200_000; a += 5) {
      rackStacks(a, rack);
      if (a < 55_000) expect(value(rack)).toBe(a);
      expect(rackColumns(rack)).toBeLessThanOrEqual(RACK_COLUMNS);
    }
    rackStacks(10_000_000, rack);
    expect(rackColumns(rack)).toBeLessThanOrEqual(RACK_COLUMNS);
  });
});

describe('Table', () => {
  test('賭けを手持ちから出し、勝ったら払い戻しと賭けが戻る', () => {
    const t = new Table(shoeOf(WIN));
    t.deal(BET);
    expect(t.chips).toBe(START_CHIPS - BET);
    t.act('stand');
    const s = t.settle();
    expect([s.payout.total, s.chips, t.chips]).toEqual([100, START_CHIPS + 100, START_CHIPS + 100]);
  });

  test('ダブルと分けた分は、ラウンドの間は手持ちから引いておく', () => {
    const t = new Table(shoeOf(['6S', '9H', '5D', '7C', 'KH', '8D']));
    t.deal(BET);
    t.act('double');
    expect(t.chips).toBe(START_CHIPS - 2 * BET);
    // ダブルで 21、ディーラーはバースト: 賭け 200 と勝ち 200 が戻る
    expect(t.settle().payout.won).toBe(200);
    expect(t.chips).toBe(START_CHIPS + 200);
  });

  test('連勝すると、勝ったラウンドに倍率の上乗せが入り、内訳の合計は手持ちと同じ', () => {
    const t = new Table(shoeOf([...WIN, ...WIN, ...LOSE]));
    for (let i = 0; i < 3; i++) {
      t.deal(BET);
      t.act('stand');
      t.settle();
    }
    // 100 + (100 + 50) - 100
    expect(t.chips).toBe(START_CHIPS + 150);
    expect(t.sheet()).toEqual({ start: START_CHIPS, won: 200, bonus: 50, lost: 100, total: t.chips });
    expect(t.streak.best).toBe(2);
  });

  test('決まったラウンドの数を精算したら終わる', () => {
    const t = new Table(shoeOf(Array.from({ length: ROUNDS }, () => WIN).flat()));
    for (let i = 0; i < ROUNDS; i++) {
      expect(t.canDeal).toBe(true);
      t.deal(BET);
      t.act('stand');
      if (i === ROUNDS - 1) expect([t.canDeal, t.over]).toEqual([false, false]);
      t.settle();
    }
    expect([t.rounds, t.over]).toEqual([ROUNDS, true]);
  });

  test('賭けられない額では配らない', () => {
    const t = new Table(shoeOf(WIN), 500);
    expect(() => t.deal(510)).toThrow();
    expect(() => t.deal(55)).toThrow();
    expect(t.rounds).toBe(0);
    t.deal(500);
    expect(t.chips).toBe(0);
  });

  test('賭けられるだけのチップがなくなったら終わる', () => {
    const t = new Table(shoeOf(LOSE), BET);
    t.deal(BET);
    t.act('stand');
    t.settle();
    expect([t.chips, t.broke, t.over]).toEqual([0, true, true]);
    expect(() => t.deal(MIN_BET)).toThrow();
  });

  test('ブラックジャックを数える', () => {
    const t = new Table(shoeOf(['AS', '9H', 'KD', '7C']));
    t.deal(BET);
    t.settle();
    expect([t.blackjacks, t.chips]).toEqual([1, START_CHIPS + 150]);
  });

  test('ベーシックストラテジーと、毎回変える賭けで打ち切れて、チップの増減は内訳と合う', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rng = new Rng(seed);
      const t = new Table(Shoe.shuffled(rng));
      while (t.canDeal) {
        const r = t.deal(fitBet(Math.floor(rng.next() * 60) * 100, t.chips));
        while (r.active >= 0) {
          const h = r.hands[r.active];
          t.act(basicAction(h.cards, r.dealer[0], { double: r.can('double'), split: r.can('split') }));
        }
        t.settle();
      }
      expect(t.over).toBe(true);
      expect(t.sheet().total).toBe(t.chips);
      expect(t.broke || t.rounds === ROUNDS).toBe(true);
    }
  });
});
