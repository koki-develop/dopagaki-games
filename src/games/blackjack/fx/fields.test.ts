import { describe, expect, test } from 'bun:test';
import { PRESENT_LONG_AGO } from '../../../juice/frame-time.ts';
import { parseCard } from '../rules/cards.ts';
import type { RoundEvent } from '../rules/round.ts';
import { DEALER } from '../rules/round.ts';
import { BACK, CARD_OFFSET, CARD_STRIDE, CardField, moveEase } from './cards.ts';
import { CHIP_OFFSET, CHIP_STRIDE, ChipField } from './chips.ts';
import { TensionMeter } from './tension.ts';

const place = (x: number, y: number) => ({ x, y, rot: 0, scale: 1 });

describe('CardField', () => {
  test('飛ばしたカードの場所は、シェーダーと同じ式で、始めの場所から速く出てゆっくり止まる', () => {
    const f = new CardField();
    f.fly(3, place(0, 0), place(10, 4), 1, 2, 0.5);
    const out = place(0, 0);
    expect(f.placeAt(3, 0.5, out)).toMatchObject({ x: 0, y: 0 });
    f.placeAt(3, 2, out);
    expect(out.x).toBeCloseTo(10 * moveEase(0.5), 9);
    expect(f.placeAt(3, 5, out)).toMatchObject({ x: 10, y: 4 });
    expect(moveEase(0.5)).toBeGreaterThan(0.5);
  });

  test('滑らせると、その時刻にいる場所から動き出す', () => {
    const f = new CardField();
    f.fly(0, place(0, 0), place(10, 0), 0, 1, 0);
    f.slide(0, place(0, 5), 0.5, 1);
    const out = place(0, 0);
    f.placeAt(0, 0.5, out);
    expect(out.x).toBeCloseTo(10 * moveEase(0.5), 9);
    expect(f.placeAt(0, 2, out)).toMatchObject({ x: 0, y: 5 });
  });

  test('返すと、半分を過ぎてから返した後の面が見える。返し始めの面は、その時刻に見えていた面', () => {
    const f = new CardField();
    f.setFace(1, BACK);
    f.flip(1, 7, 2, 0.4);
    expect([f.faceAt(1, 2.1), f.faceAt(1, 2.25)]).toEqual([BACK, 7]);
    f.flip(1, BACK, 3, 0.2);
    expect(f.data[CARD_STRIDE + CARD_OFFSET.faceA]).toBe(7);
  });

  test('消すと、どの時刻も起きていない状態に戻り、版が上がる', () => {
    const f = new CardField();
    f.fly(2, place(0, 0), place(1, 1), 0, 1, 0);
    f.dim(2, 3);
    const v = f.version;
    f.clear();
    expect(f.version).toBeGreaterThan(v);
    expect([f.isVisible(2), f.data[2 * CARD_STRIDE + CARD_OFFSET.dimAt]]).toEqual([false, PRESENT_LONG_AGO]);
  });
});

describe('ChipField', () => {
  test('今の場所から飛ばし直せて、額面と着く時刻を覚える', () => {
    const f = new ChipField();
    f.fly(0, 3, 0, 0, 4, 0, 0, 1, 0);
    f.flyFromHere(0, 4, 8, 0.5, 1, 0);
    const d = f.data;
    expect(d[CHIP_OFFSET.fromX]).toBeCloseTo(4 * moveEase(0.5), 9);
    expect([f.denominationOf(0), d[CHIP_OFFSET.landAt]]).toEqual([3, 1.5]);
    f.clear();
    expect(f.denominationOf(0)).toBe(-1);
  });

  test('同じ枠へ新しいチップを飛ばすと、前のチップの暗さ・消え始め・光を捨てる。上の面の向きは枠ごとに違う', () => {
    const f = new ChipField();
    f.fly(1, 2, 0, 0, 1, 1, 0, 1, 0);
    f.dim(1, 0.5);
    f.fade(1, 0.6);
    f.shine(1, 0.7);
    f.fly(1, 4, 0, 0, 1, 1, 2, 1, 0);
    const o = CHIP_STRIDE;
    expect([f.data[o + CHIP_OFFSET.dimAt], f.data[o + CHIP_OFFSET.fadeAt], f.data[o + CHIP_OFFSET.shineAt]]).toEqual(new Array(3).fill(PRESENT_LONG_AGO));
    expect(f.denominationOf(1)).toBe(4);
    expect(f.data[o + CHIP_OFFSET.spin]).not.toBe(f.data[2 * CHIP_STRIDE + CHIP_OFFSET.spin]);
  });
});

describe('TensionMeter', () => {
  const unseen = (): Int32Array => {
    const u = new Int32Array(10).fill(8);
    u[9] = 32;
    return u;
  };
  const deal = (hand: number, card: string, faceUp = true, chosen = false): RoundEvent => ({ t: 'deal', hand, card: parseCard(card), faceUp, chosen });

  test('最初の 4 枚は溜めず、選んで引く 1 枚はバーストするかの分からなさ。伏せたカードは見えていないものとして数える', () => {
    const m = new TensionMeter(unseen(), 100);
    expect([m.see(deal(0, '10S')), m.see(deal(DEALER, '9H')), m.see(deal(0, '6D')), m.see(deal(DEALER, '7C', false))]).toEqual([0, 0, 0, 0]);
    // 16 に引いてバーストするのは 6〜10 点（6: 7 枚、7: 8 枚、8: 8 枚、9: 7 枚、10 点: 31 枚）。見えていないのは 101 枚
    const p = 61 / 101;
    expect(m.see(deal(0, '2S', true, true))).toBeCloseTo(4 * p * (1 - p), 12);
  });

  test('ディーラーの確かめは溜めない。確かめてブラックジャックと分かったら、表にするときも溜めない', () => {
    const m = new TensionMeter(unseen(), 100);
    m.see(deal(0, '10S'));
    m.see(deal(DEALER, 'AH'));
    m.see(deal(0, '9D'));
    m.see(deal(DEALER, 'KC', false));
    expect(m.see({ t: 'peek', blackjack: true })).toBe(0);
    expect(m.see({ t: 'reveal', card: parseCard('KC') })).toBe(0);
  });

  test('ディーラーの伏せたカードは、決着していない手があればラウンドに勝つかの分からなさ。すべて決着していれば 0', () => {
    const contested = new TensionMeter(unseen(), 100);
    for (const e of [deal(0, '10S'), deal(DEALER, '7H'), deal(0, '8D'), deal(DEALER, '9C', false)]) contested.see(e);
    const t = contested.see({ t: 'reveal', card: parseCard('9C') });
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(1);
    const settled = new TensionMeter(unseen(), 100);
    for (const e of [deal(0, '10S'), deal(DEALER, '7H'), deal(0, '6D'), deal(DEALER, '9C', false), deal(0, 'KH', true, true)]) settled.see(e);
    settled.see({ t: 'settle', hand: 0, result: 'lose', delta: -100 });
    expect(settled.see({ t: 'reveal', card: parseCard('9C') })).toBe(0);
  });

  test('混ぜ直したら、混ぜ直したシューと伏せたままのカードを見えていないものとする', () => {
    const m = new TensionMeter(unseen(), 100);
    for (const e of [deal(0, '10S'), deal(DEALER, '7H'), deal(0, '6D'), deal(DEALER, '9C', false)]) m.see(e);
    const remaining = new Int32Array(10);
    remaining[9] = 2;
    remaining[4] = 2;
    m.see({ t: 'reshuffle', remaining });
    // 10 点 2 枚・5 が 2 枚と伏せた 9: 16 に引くと 5 枚のうち 3 枚でバースト
    const p = 3 / 5;
    expect(m.see(deal(0, '5S', true, true))).toBeCloseTo(4 * p * (1 - p), 12);
  });
});
