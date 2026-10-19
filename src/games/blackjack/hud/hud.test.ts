import { describe, expect, test } from 'bun:test';
import { ROUNDS } from '../scoring.ts';
import type { BetLabel, HandLabel, HudState } from '../types.ts';
import { computeHudLayout, sameHudLayout } from './layout.ts';
import { HudModel, totalText } from './model.ts';
import { HudPresenter } from './writer.ts';
import type { HudTarget } from './writer.ts';

const label = (over: Partial<HandLabel> = {}): HandLabel => ({ shown: false, total: 0, soft: false, state: 'waiting', x: 0, y: 0, ...over });
const bet = (over: Partial<BetLabel> = {}): BetLabel => ({ shown: false, amount: 0, crowded: false, x: 0, y: 0, width: 0, ...over });

const state = (over: Partial<HudState> = {}): HudState => ({
  runId: 1,
  chips: 1000,
  newBest: false,
  streak: 0,
  nextMultiplierTenths: 10,
  fever: 0,
  round: 1,
  finalRound: false,
  slip: { open: false, bet: 0, limit: 0 },
  actions: { hit: false, stand: false, double: false, split: false },
  dealer: label(),
  hands: [label(), label(), label(), label()],
  bets: [bet(), bet(), bet(), bet()],
  ...over,
});

describe('HudModel', () => {
  test('手持ちは実際の値へ転がるように動き、増える間は正、減る間は負に跳ねる', () => {
    const m = new HudModel(state());
    const up = m.update(state({ chips: 1500 }), 1 / 60);
    const first = Number(up.chips.replace(/,/g, ''));
    expect(first).toBeGreaterThan(1000);
    expect(first).toBeLessThan(1500);
    expect(up.chipsBump).toBe(1);
    let f = up;
    for (let i = 0; i < 240; i++) f = m.update(state({ chips: 1500 }), 1 / 60);
    expect([f.chips, f.chipsBump]).toEqual(['1,500', 0]);
    expect(m.update(state({ chips: 1400 }), 1 / 60).chipsBump).toBe(-1);
  });

  test('合計の札は、ソフトで 21 未満なら A を 1 と数えた合計も添える', () => {
    expect([totalText(17, true), totalText(21, true), totalText(16, false)]).toEqual(['7 or 17', '21', '16']);
    const m = new HudModel(state());
    const f = m.update(state({ hands: [label({ shown: true, total: 17, soft: true, state: 'active', x: 10.04, y: 20 }), label(), label(), label()] }), null);
    expect(f.hands[0]).toEqual({ shown: true, text: '7 or 17', state: 'active', x: 10, y: 20 });
  });

  test('賭けの額の札は、額を 3 桁ごとに区切って出し、その手に使える幅を添える', () => {
    const m = new HudModel(state());
    const f = m.update(state({ bets: [bet({ shown: true, amount: 2500, crowded: true, x: 50.04, y: 80, width: 72.04 }), bet(), bet(), bet()] }), null);
    expect(f.bets[0]).toEqual({ shown: true, text: '2,500', crowded: true, allIn: false, x: 50, y: 80, width: 72 });
    expect(f.bets[1].shown).toBe(false);
  });

  test('連勝は 2 から出し、倍率とラウンドを文字にする', () => {
    const m = new HudModel(state());
    expect(m.update(state({ streak: 1, nextMultiplierTenths: 15 }), null)).toMatchObject({ streak: '', multiplier: '×1.5', round: `1/${ROUNDS}` });
    expect(m.update(state({ streak: 3, nextMultiplierTenths: 25, round: ROUNDS, finalRound: true }), 1 / 60)).toMatchObject({
      streak: '3',
      multiplier: '×2.5',
      round: `${ROUNDS}/${ROUNDS}`,
      finalRound: true,
    });
  });

  test('賭けのボタンは、賭けを選んでいる間だけ押せる。チップとすべて賭けるは上限に届くまで、取り消すは置いているとき、配るは下限以上のとき', () => {
    const m = new HudModel(state());
    const closed = m.update(state(), null);
    expect([closed.betting, ...Object.values(closed.bet)]).toEqual(new Array(8).fill(false));
    const empty = m.update(state({ slip: { open: true, bet: 0, limit: 1000 } }), 1 / 60);
    expect([empty.betting, empty.bet[10], empty.bet[1000], empty.bet.allIn, empty.bet.clear, empty.bet.deal, empty.bets[0].allIn]).toEqual([true, true, true, true, false, false, false]);
    const full = m.update(state({ slip: { open: true, bet: 1000, limit: 1000 }, bets: [bet({ shown: true, amount: 1000 }), bet(), bet(), bet()] }), 1 / 60);
    expect([full.bet[10], full.bet[1000], full.bet.allIn, full.bet.clear, full.bet.deal]).toEqual([false, false, false, true, true]);
    // 手持ちすべての賭けには ALL IN と添える
    expect(full.bets[0].allIn).toBe(true);
  });

  test('毎フレーム同じ入れ物を返し、値が変わらなければ文字列を作り直さない', () => {
    const m = new HudModel(state());
    const a = m.update(state(), null);
    const chips = a.chips;
    const b = m.update(state(), 1 / 60);
    expect(b).toBe(a);
    expect(b.chips).toBe(chips);
  });
});

describe('HudPresenter', () => {
  test('最初はすべて書き、以後は変わった値だけを書く。runId が変わったら書き直す', () => {
    const log: string[] = [];
    const t: HudTarget = {
      chips: (text, bump, best) => void log.push(`chips ${text} ${bump} ${best}`),
      streak: (count, mult, fever) => void log.push(`streak ${count} ${mult} ${fever}`),
      round: (text, final) => void log.push(`round ${text} ${final}`),
      betting: (on) => void log.push(`betting ${on}`),
      bet: (c, on) => void log.push(`bet ${c} ${on}`),
      action: (a, on) => void log.push(`action ${a} ${on}`),
      label: (i, l) => void log.push(`label ${i} ${l.shown}`),
      betLabel: (i, b) => void log.push(`betLabel ${i} ${b.shown}`),
    };
    const p = new HudPresenter(t);
    p.push(state(), 0);
    // 手持ち・連勝・ラウンド・どちらのボタンか・賭けのボタン 7・操作のボタン 4・合計の札 5・賭けの札 4
    const all = 1 + 1 + 1 + 1 + 7 + 4 + 5 + 4;
    expect(log).toHaveLength(all);
    log.length = 0;
    p.push(state(), 1 / 60);
    expect(log).toEqual([]);
    p.push(state({ actions: { hit: true, stand: true, double: false, split: false } }), 2 / 60);
    expect(log).toEqual(['action hit true', 'action stand true']);
    log.length = 0;
    p.push(state({ runId: 2 }), 3 / 60);
    expect(log).toHaveLength(all);
  });
});

describe('computeHudLayout', () => {
  test('HUD の下端と、下端のボタンの上端から下の高さを、描画領域を基準に返す', () => {
    const l = computeHudLayout({ left: 0, top: 10, width: 390, height: 800 }, { left: 0, top: 10, width: 390, height: 70 }, { left: 0, top: 700, width: 390, height: 110 });
    expect(l).toEqual({ top: 70, bottom: 110 });
    expect(sameHudLayout(null, l)).toBe(false);
    expect(sameHudLayout(l, { ...l })).toBe(true);
    expect(sameHudLayout(l, { ...l, bottom: 111 })).toBe(false);
  });
});
