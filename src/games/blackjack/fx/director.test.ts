import { describe, expect, test } from 'bun:test';
import { HAPTICS, SUSPENSE } from '../config.ts';
import { PRESENT_LONG_AGO } from '../../../juice/frame-time.ts';
import { CHIP_VALUES, MAX_STACK } from '../denominations.ts';
import { START_CHIPS } from '../scoring.ts';
import { runResult } from '../result.test-support.ts';
import { CHIP_OFFSET, CHIP_STRIDE, RACK_SLOTS } from './chips.ts';
import { DirectorKit } from './test-kit.test-support.ts';

/** 勝つラウンド（プレイヤー 20 対ディーラー 17、止める）と、負けるラウンド（17 対 20） */
const WIN = ['10S', '10H', 'QD', '7C'];
const LOSE = ['10S', '10H', '7D', 'QC'];

describe('Director の配る演出', () => {
  test('配り終えると、手とディーラーの合計の札を出す。ディーラーは伏せたカードを数えない', () => {
    const k = new DirectorKit(['10S', '7H', '6D', '9C']);
    k.deal();
    expect(k.hud.hands[0]).toMatchObject({ shown: true, total: 16, soft: false });
    expect(k.hud.dealer).toMatchObject({ shown: true, total: 7 });
    expect(k.hud.chips).toBe(START_CHIPS - 100);
    expect(k.rec.calls('announce').some((c) => c.args[0] === 'ディーラーは 1 枚を伏せました')).toBe(true);
  });

  test('手持ちの多くを賭けてバーストしそうな 1 枚は、伏せて置いてから、絞り込み、ほかの音を消してドラムロールで溜めて返す。溜めの長さは分からなさから決める', () => {
    const k = new DirectorKit(['10S', '10H', '6D', '7C', '5S']);
    k.deal(START_CHIPS * SUSPENSE.bigStake);
    const start = k.ft.world;
    k.act('hit');
    expect(k.rec.calls('audio.silence')).toHaveLength(1);
    expect(k.rec.count('sfx.drumRoll')).toBe(1);
    expect(k.maxFocus).toBeGreaterThan(0.3);
    const flips = k.rec.calls('sfx.flip').filter((c) => c.args[0] === true && c.world >= start);
    expect(flips).toHaveLength(1);
    // 16 に 1 枚引いてバーストする割合は 6 割ほどで、分からなさは big を超える
    expect((flips[0].world - start) as number).toBeGreaterThan(SUSPENSE.hold.base + SUSPENSE.hold.perTension * SUSPENSE.big);
  });

  test('賭けが手持ちの bigStake に届かなければ、分からない 1 枚も伏せて置いて間を取るだけで、絞り込まず、音も消さない', () => {
    const k = new DirectorKit(['10S', '10H', '6D', '7C', '5S']);
    k.deal(START_CHIPS * SUSPENSE.bigStake - 10);
    const start = k.ft.world;
    k.act('hit');
    expect(k.rec.count('audio.silence')).toBe(0);
    expect(k.rec.count('sfx.drumRoll')).toBe(0);
    expect(k.maxFocus).toBe(0);
    const flips = k.rec.calls('sfx.flip').filter((c) => c.args[0] === true && c.world >= start);
    expect(flips).toHaveLength(1);
    expect((flips[0].world - start) as number).toBeGreaterThan(SUSPENSE.hold.base + SUSPENSE.hold.perTension * SUSPENSE.big);
  });

  test('大きな溜めは 1 ラウンドに 1 回まで（引いた 1 枚で溜めたら、ディーラーの伏せたカードは間を取るだけ）', () => {
    // 12 に 1 枚引いて 15（バーストは 3 割ほど）、止めてディーラー 10 の伏せたカード次第で勝ち負けが決まる
    const k = new DirectorKit(['10S', '10H', '2D', '6C', '3S'], { fullShoe: true });
    k.deal(START_CHIPS / 2);
    k.act('hit');
    expect(k.rec.count('sfx.drumRoll')).toBe(1);
    const start = k.ft.world;
    k.act('stand');
    expect(k.rec.count('sfx.drumRoll')).toBe(1);
    expect(k.rec.calls('audio.silence')).toHaveLength(1);
    expect(k.rec.calls('sfx.flip').some((c) => c.args[0] === true && c.world > start)).toBe(true);
  });

  test('ダブルで場の賭けが手持ちの bigStake に届いたら、その 1 枚は大きな溜めにする', () => {
    // 手持ち 1000 で 100 を賭け、11 でダブル（場に 200）。次は 5（16）でバーストはしないので、ディーラーの番で確かめる
    const k = new DirectorKit(['6S', '10H', '5D', '7C', '5S', '9H'], { fullShoe: true });
    k.deal(START_CHIPS * SUSPENSE.bigStake / 2);
    k.act('double');
    expect(k.rec.count('sfx.drumRoll')).toBeGreaterThan(0);
    expect(k.maxFocus).toBeGreaterThan(0);
  });

  test('結果の分かっている 1 枚（バーストしない合計）は、溜めずに飛んでいる間に返す', () => {
    const k = new DirectorKit(['2S', '10H', '3D', '7C', '5S']);
    k.deal();
    const start = k.ft.world;
    k.act('hit');
    expect(k.rec.count('audio.silence')).toBe(0);
    expect(k.rec.calls('sfx.flip').filter((c) => c.world >= start && c.args[0] === true)).toHaveLength(0);
  });

  test('ディーラーの伏せたカードは、勝ち負けが分からなければ溜めてから返す', () => {
    // プレイヤー 18 対ディーラー 7: 伏せたカード次第（9 で 16、K を引いてバースト）。2 組のシューの残りから確率を測る
    const k = new DirectorKit(['10S', '7H', '8D', '9C', 'KS'], { fullShoe: true });
    k.deal();
    const start = k.ft.world;
    k.act('stand');
    expect(k.rec.calls('sfx.flip').some((c) => c.args[0] === true && c.world > start)).toBe(true);
  });
});

describe('Director の合計の札', () => {
  test('A を 11 と数える合計は、まだ引ける間だけ「or」で添え、止めた手と引き終えたディーラーは決まった合計だけを出す', () => {
    // プレイヤー A+6（ソフト 17）、ディーラー 9 と伏せた 8（17、引かない）
    const k = new DirectorKit(['AS', '9H', '6D', '8C'], { fullShoe: true });
    k.deal();
    expect(k.hud.hands[0]).toMatchObject({ total: 17, soft: true });
    k.act('stand');
    expect(k.hud.hands[0]).toMatchObject({ total: 17, soft: false });
    // ディーラー A+6 で止める（ソフト 17）
    const d = new DirectorKit(['10S', '6H', '9D', 'AC'], { fullShoe: true });
    d.deal();
    d.act('stand');
    expect(d.hud.dealer).toMatchObject({ total: 17, soft: false });
  });
});

describe('Director の合計の札（引いた瞬間）', () => {
  test('ディーラーが引いた 1 枚で合計が決まるなら、表になったフレームから「or」を添えない', () => {
    // プレイヤー 10+9 で止める。ディーラー 6 と伏せた 2（8）から A を引いてソフト 19 で止める
    const k = new DirectorKit(['10S', '6H', '9D', '2C', 'AS'], { fullShoe: true });
    k.deal();
    const r = k.table.round;
    if (!r) throw new Error('no round');
    k.table.act('stand');
    const end = k.director.play(r, k.ft);
    const seen: string[] = [];
    while (k.ft.world < end) {
      k.frame();
      const d = k.hud.dealer;
      if (d.shown) seen.push(`${d.total}${d.soft ? 's' : ''}`);
    }
    expect(seen).toContain('19');
    expect(seen.some((v) => v.endsWith('s'))).toBe(false);
  });

  test('プレイヤーが引いてまだ引ける手は「or」を添え、ダブルで受けた 1 枚は表になったフレームから添えない', () => {
    // A+2（ソフト 13）で引いて A+2+3（ソフト 16）。まだ引ける
    const hit = new DirectorKit(['AS', '9H', '2D', '7C', '3S'], { fullShoe: true });
    hit.deal();
    hit.act('hit');
    expect(hit.hud.hands[0]).toMatchObject({ total: 16, soft: true });
    // A+2 でダブルして 4 を受け、ソフト 17 で止める
    const dbl = new DirectorKit(['AS', '9H', '2D', '7C', '4S'], { fullShoe: true });
    dbl.deal();
    const r = dbl.table.round;
    if (!r) throw new Error('no round');
    dbl.table.act('double');
    const end = dbl.director.play(r, dbl.ft);
    let softAt17 = false;
    while (dbl.ft.world < end) {
      dbl.frame();
      const h = dbl.hud.hands[0];
      if (h.total === 17 && h.soft) softAt17 = true;
    }
    expect(softAt17).toBe(false);
  });
});

describe('Director のディーラーの確かめ', () => {
  test('A を見せたディーラーは、伏せたカードの角を持ち上げて確かめるだけで溜めない。ブラックジャックでなければ何も知らせず操作を待つ', () => {
    // プレイヤー 10+9、ディーラー A と伏せた 7
    const k = new DirectorKit(['10S', 'AH', '9D', '7C'], { fullShoe: true });
    k.deal();
    expect(k.rec.count('sfx.peek')).toBe(1);
    expect([k.rec.count('audio.silence'), k.rec.count('sfx.drumRoll')]).toEqual([0, 0]);
    expect(k.callouts).toHaveLength(0);
    // 伏せたカードは表にしない
    expect(k.hud.dealer.total).toBe(11);
  });

  test('確かめてブラックジャックなら、伏せたカードを表にして知らせる', () => {
    const k = new DirectorKit(['10S', 'AH', '9D', 'KC'], { fullShoe: true });
    k.deal();
    k.settle();
    expect(k.rec.count('sfx.dealerBlackjack')).toBe(1);
    expect(k.hud.dealer.total).toBe(21);
  });
});

describe('Director の勝ち負け', () => {
  test('バーストには祝福に見える光・上がっていく音・払い戻しの音を付けない', () => {
    const k = new DirectorKit(['10S', '6H', '6D', '5C', 'KH']);
    k.deal();
    const from = k.rec.log.length;
    k.act('hit');
    k.settle();
    const names = k.rec.log.slice(from).map((l) => l.name);
    expect(names).toContain('sfx.bust');
    for (const n of ['sfx.win', 'sfx.coin', 'sfx.blackjack', 'sfx.twentyOne', 'sfx.dealerBust', 'flash.request', 'sfx.newBest']) expect(names).not.toContain(n);
    expect(k.callouts.find((c) => c.kind === 'loss')).toMatchObject({ total: -100 });
    expect(k.hud.chips).toBe(START_CHIPS - 100);
  });

  test('ブラックジャックは、専用の音・文字・光・振動で決め、3:2 の払い戻しが手持ちに戻る', () => {
    const k = new DirectorKit(['AS', '9H', 'KD', '7C']);
    k.deal();
    expect(k.rec.count('sfx.blackjack')).toBe(1);
    expect(k.callouts.some((c) => c.kind === 'blackjack')).toBe(true);
    expect(k.rec.calls('vibrate').some((c) => c.args[0] === HAPTICS.natural)).toBe(true);
    expect(k.rec.calls('flash.request').some((c) => c.args[0] === true)).toBe(true);
    k.settle();
    expect(k.hud.chips).toBe(START_CHIPS + 150);
    expect(k.callouts.find((c) => c.kind === 'payout')).toMatchObject({ total: 150, level: 0 });
  });

  test('ふつうの勝ちはヒットストップしない。勝ちの段階が 1 以上ならヒットストップの振動を出す', () => {
    const plain = new DirectorKit(WIN);
    plain.deal();
    plain.act('stand');
    plain.settle();
    expect(plain.rec.count('vibrate')).toBe(0);
    // ダブルで 21、ディーラーはバースト: 200 の勝ち（段階 1）
    const big = new DirectorKit(['6S', '9H', '5D', '7C', 'KH', '8D']);
    big.deal();
    big.act('double');
    big.settle();
    expect(big.callouts.find((c) => c.kind === 'payout')).toMatchObject({ total: 200, level: 1 });
    expect(big.rec.calls('vibrate').some((c) => c.args[0] === HAPTICS.hitStop.base + HAPTICS.hitStop.perTier)).toBe(true);
  });

  test('山に積みきれないほど大きな賭けでも、勝って手持ちへ集めると、HUD の手持ちが卓の手持ちと一致する', () => {
    const chips = 3_000_000;
    const k = new DirectorKit(WIN, { chips });
    k.deal(2_500_000);
    expect(k.hud.chips).toBe(chips - 2_500_000);
    k.act('stand');
    k.settle();
    expect(k.hud.chips).toBe(k.table.chips);
    expect(k.hud.chips).toBe(chips + 2_500_000);
  });

  test('連勝が積まれたら連勝と次の倍率を出し、負けで途切れたら知らせる。上乗せの分まで手持ちに戻る', () => {
    const k = new DirectorKit([...WIN, ...WIN, ...LOSE]);
    for (let i = 0; i < 3; i++) {
      k.deal();
      k.act('stand');
      k.settle();
    }
    expect(k.callouts.filter((c) => c.kind === 'streak')).toEqual([{ kind: 'streak', count: 2, multiplierTenths: 20 }]);
    expect(k.callouts.find((c) => c.kind === 'payout' && c.bonus > 0)).toMatchObject({ total: 150, bonus: 50, multiplierTenths: 15 });
    expect(k.callouts.filter((c) => c.kind === 'streakBreak')).toEqual([{ kind: 'streakBreak', count: 2 }]);
    expect(k.rec.count('sfx.streakBreak')).toBe(1);
    expect(k.hud.chips).toBe(k.table.chips);
    expect(k.hud.chips).toBe(START_CHIPS + 150);
  });

  test('引き分けは増減 0 の文字だけで、上がる音も下がる音も付けない', () => {
    const k = new DirectorKit(['10S', '10H', 'QD', 'KC']);
    k.deal();
    k.act('stand');
    const from = k.rec.log.length;
    k.settle();
    const names = k.rec.log.slice(from).map((l) => l.name);
    expect(names).not.toContain('sfx.win');
    expect(names).not.toContain('sfx.lose');
    expect(k.callouts.some((c) => c.kind === 'push')).toBe(true);
    expect(k.hud.chips).toBe(START_CHIPS);
  });

  test('分けた手の 1 勝 1 敗（差し引き 0）は、勝った手を光らせず、上がっていく音も光も出さない', () => {
    // 8,8 を分ける。左 8+K=18、右 8+5=13。ディーラーは 9+7=16 から A でソフト 17
    const k = new DirectorKit(['8S', '9H', '8D', '7C', 'KH', '5D', 'AS']);
    k.deal();
    const from = k.rec.log.length;
    k.act('split');
    k.act('stand');
    k.act('stand');
    k.settle();
    expect(k.settlements[0].payout.total).toBe(0);
    const names = k.rec.log.slice(from).map((l) => l.name);
    for (const n of ['sfx.coin', 'sfx.win', 'flash.request']) expect(names).not.toContain(n);
    expect(names).toContain('sfx.chip');
    expect(k.callouts.some((c) => c.kind === 'push')).toBe(true);
  });

  test('負けたラウンドのディーラーのバーストは、祝わずに事実だけを出す', () => {
    // 8,8 を分ける。左 8+4=12 でダブルして K でバースト（-200）。右 8+9=17。ディーラー 9+7=16 から 10 でバースト（+100）
    const k = new DirectorKit(['8S', '9H', '8D', '7C', '4H', 'KH', '9D', '10S']);
    k.deal();
    const from = k.rec.log.length;
    k.act('split');
    k.act('double');
    k.act('stand');
    k.settle();
    expect(k.settlements[0].payout.total).toBe(-100);
    const names = k.rec.log.slice(from).map((l) => l.name);
    expect(k.rec.calls('sfx.dealerBust').map((c) => c.args)).toEqual([[false]]);
    expect(k.callouts.find((c) => c.kind === 'dealerBust')).toMatchObject({ celebrate: false });
    for (const n of ['sfx.coin', 'sfx.win', 'flash.request']) expect(names).not.toContain(n);
  });

  test('ディーラーもブラックジャックの引き分けは、ブラックジャックとして祝わない', () => {
    const k = new DirectorKit(['AS', 'AH', 'KD', 'KC']);
    k.deal();
    k.settle();
    for (const n of ['sfx.blackjack', 'sfx.coin', 'flash.request']) expect(k.rec.count(n)).toBe(0);
    expect(k.callouts.some((c) => c.kind === 'blackjack')).toBe(false);
    expect(k.hud.chips).toBe(START_CHIPS);
  });

  test('最高スコアの更新は、終わりの儀式の決着の後に、記録を超えて終えたときだけ出す', () => {
    const play = (newBest: boolean) => {
      const k = new DirectorKit(WIN);
      k.deal();
      k.act('stand');
      k.settle();
      expect(k.rec.count('sfx.newBest')).toBe(0);
      k.director.ending(runResult({ newBest, previousBest: 1050 }), k.ft);
      k.until(k.ft.world + 6);
      return k;
    };
    const best = play(true);
    expect(best.rec.count('sfx.newBest')).toBe(1);
    expect(best.hud.newBest).toBe(true);
    expect(best.rec.calls('sfx.newBest')[0].world).toBeGreaterThan(best.rec.calls('sfx.verdict')[0].world);
    const plain = play(false);
    expect([plain.rec.count('sfx.newBest'), plain.hud.newBest]).toEqual([0, false]);
  });

  test('記録を超えても減らして終えたときは、更新を祝わずに HUD に BEST を付けるだけにする', () => {
    const k = new DirectorKit(WIN);
    k.director.ending(runResult({ outcome: 'loss', newBest: true, previousBest: 600 }), k.ft);
    k.until(k.ft.world + 6);
    expect(k.rec.count('sfx.newBest')).toBe(0);
    expect(k.hud.newBest).toBe(true);
    expect(k.rec.calls('announce').some((c) => c.args[0] === '最高スコアを更新しました')).toBe(true);
  });

  test('精算した後も、チップが手持ちへ飛び立つまでは賭けの札と賭けの丸を出しておく', () => {
    const k = new DirectorKit(WIN);
    k.deal(300);
    k.act('stand');
    const s = k.table.settle();
    k.director.roundEnd(s, k.ft);
    k.frame();
    expect(k.hud.bets[0]).toMatchObject({ shown: true, amount: 300 });
    expect(k.fx.spots[3]).toBe(1);
    k.until(k.ft.world + 3);
    expect(k.hud.bets[0].shown).toBe(false);
  });

  test('終わりの儀式を飛ばしても、記録を超えていれば HUD に BEST を付ける', () => {
    const k = new DirectorKit(WIN);
    k.director.ending(runResult({ newBest: true }), k.ft);
    k.frame();
    expect(k.director.skip()).toBe(true);
    k.frame();
    expect(k.hud.newBest).toBe(true);
    expect(k.rec.count('sfx.newBest')).toBe(0);
  });
});

describe('Director の賭け', () => {
  test('賭けを額面に崩したチップの山を手持ちから積み、額を賭けの札に出す。額を変えると積み直し、取り消すと手持ちへ戻す', () => {
    const k = new DirectorKit(WIN);
    // 最初の手の賭けの山（手持ちの山の枠の後の MAX_STACK 枚）のうち、消していないチップの額
    const stack = () => {
      const out: number[] = [];
      for (let s = RACK_SLOTS; s < RACK_SLOTS + MAX_STACK; s++) {
        const d = k.chips.denominationOf(s);
        if (d >= 0 && k.chips.data[s * CHIP_STRIDE + CHIP_OFFSET.fadeAt] === Math.fround(PRESENT_LONG_AGO)) out.push(CHIP_VALUES[d]);
      }
      return out;
    };
    k.openBetting(350);
    k.frame();
    expect(stack()).toEqual([100, 100, 100, 25, 25]);
    expect(k.hud.chips).toBe(START_CHIPS - 350);
    expect(k.hud.bets[0]).toMatchObject({ shown: true, amount: 350 });
    k.director.setBet(1100, k.ft);
    k.frame();
    expect(stack()).toEqual([1000, 100]);
    expect(k.hud.chips).toBe(START_CHIPS - 1100);
    k.director.setBet(0, k.ft);
    k.frame();
    expect(k.hud.chips).toBe(START_CHIPS);
    expect(k.hud.bets[0].shown).toBe(false);
    expect(k.rec.count('sfx.sweep')).toBe(1);
  });

  test('卓の手前の手持ちの山は、いつも HUD の手持ちと同じ額を、額面ごとの山に崩して見せる', () => {
    const k = new DirectorKit(WIN);
    // 手持ちの山の枠のうち、消していないチップの額の合計
    const rack = () => {
      let sum = 0;
      for (let s = 0; s < RACK_SLOTS; s++) {
        const d = k.chips.denominationOf(s);
        if (d >= 0 && k.chips.data[s * CHIP_STRIDE + CHIP_OFFSET.fadeAt] === Math.fround(PRESENT_LONG_AGO)) sum += CHIP_VALUES[d];
      }
      return sum;
    };
    k.director.intro(k.ft);
    k.frame();
    expect(rack()).toBe(START_CHIPS);
    k.deal(350);
    expect(rack()).toBe(START_CHIPS - 350);
    k.act('stand');
    k.settle();
    expect([rack(), k.hud.chips]).toEqual([START_CHIPS + 350, START_CHIPS + 350]);
  });

  test('賭けた額で配り、勝てば置いたチップと払い戻しのチップの額がそのまま手持ちに戻る', () => {
    const k = new DirectorKit(WIN);
    k.deal(350);
    k.act('stand');
    k.settle();
    expect(k.hud.chips).toBe(START_CHIPS + 350);
    expect(k.hud.chips).toBe(k.table.chips);
  });

  test('勝ちの段階は、配る前の手持ちに対する増え方で決める（手持ちをすべて賭けた勝ちは大きな勝ち）', () => {
    const k = new DirectorKit(WIN);
    k.deal(START_CHIPS);
    k.act('stand');
    k.settle();
    expect(k.callouts.find((c) => c.kind === 'payout')).toMatchObject({ total: START_CHIPS, level: 3 });
  });

  test('BGM は、ラウンドが進んでも、フィーバーでも、最後のラウンドでも終わりの儀式でも変えない（段階は 0 のまま、ライザーは使わない）', () => {
    const k = new DirectorKit([...WIN, ...WIN, ...WIN, ...WIN]);
    for (let i = 0; i < 3; i++) {
      k.deal();
      k.act('stand');
      k.settle();
    }
    k.until(k.ft.world + 1);
    expect(k.fx.fever).toBeGreaterThan(0);
    k.director.openBetting(100, true, k.ft);
    k.until(k.ft.world + 1);
    k.director.ending(runResult(), k.ft);
    k.until(k.ft.world + 6);
    const tiers = k.rec.calls('bgm.setTier').map((c) => c.args[0]);
    expect(tiers.length).toBeGreaterThan(0);
    expect(new Set(tiers)).toEqual(new Set([0]));
    expect(k.rec.count('bgm.setRiser')).toBe(0);
  });

  test('最後のラウンドの賭けを選び始めたら、最後のラウンドを知らせる', () => {
    const k = new DirectorKit(WIN);
    k.director.openBetting(100, false, k.ft);
    expect(k.callouts.filter((c) => c.kind === 'finalRound')).toHaveLength(0);
    k.director.openBetting(100, true, k.ft);
    expect(k.callouts.filter((c) => c.kind === 'finalRound')).toHaveLength(1);
    expect(k.rec.count('sfx.finalRound')).toBe(1);
    expect(k.fx.finalRound).toBe(1);
  });
});
