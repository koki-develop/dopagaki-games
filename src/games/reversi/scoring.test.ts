import { describe, expect, test } from 'bun:test';
import { Combo, COMBO_WINDOW, FEVER, feverLevel, QUICK_WINDOW } from './combo.ts';
import { BLACK, parseSquare, play, positionFromRows } from './rules/position.ts';
import { sheetOf } from './result.test-support.ts';
import { comboMultiplier, flipPoints, SCORE, ScoreKeeper, scoreMove } from './scoring.ts';

describe('スコア', () => {
  test('返した石は n 枚目が n × 10 点。多く返す手ほど 1 枚あたりが高い', () => {
    expect([1, 2, 3, 5, 8].map(flipPoints)).toEqual([10, 30, 60, 150, 360]);
  });

  test('コンボの倍率は 1 で ×1、1 つごとに 0.1 上がり、×3 で止まる。0.1 刻みで誤差がない', () => {
    expect([0, 1, 2, 6, 11, 21, 40].map(comboMultiplier)).toEqual([1, 1, 1.1, 1.5, 2, 3, 3]);
    for (let c = 1; c <= 21; c++) expect(comboMultiplier(c) * 10).toBe(Math.round(comboMultiplier(c) * 10));
  });

  test('1 手の点は、返した石・角・確定石の合計に倍率を掛けて丸め、早打ちなら倍率を掛けずに早打ちの点を足す', () => {
    const move = (flipped: number, corner: boolean, stableGained: number, combo: number, quick = false) => scoreMove({ flipped, corner, stableGained, combo, quick });
    expect(move(3, true, 2, 6)).toEqual({ flips: 60, corner: SCORE.corner, stable: 40, base: 600, multiplier: 1.5, quick: 0, total: 900 });
    expect(move(1, false, 0, 0).total).toBe(10);
    expect(move(2, false, 1, 4).total).toBe(Math.round(50 * 1.3));
    expect(move(3, true, 2, 6, true)).toMatchObject({ quick: SCORE.quick, total: 900 + SCORE.quick });
  });

  test('終局の点は、手の点・早打ち・石の数・勝ち・パーフェクト・コンボ（最大コンボかフルコンボ）を足す。負けには勝ちの点を付けない', () => {
    const win = sheetOf({ moves: 3000, discs: 40, won: true, perfect: false, maxCombo: 7 });
    expect(win).toEqual({ moves: 3000, quick: 0, discPoints: 4000, win: SCORE.win, perfect: 0, comboPoints: 1400, total: 3000 + 4000 + SCORE.win + 1400 });
    // フルコンボは、最大コンボの点の代わりにフルコンボの点を付ける
    const full = sheetOf({ moves: 3000, quick: 800, discs: 40, won: true, maxCombo: 7, fullCombo: true });
    expect([full.quick, full.comboPoints, full.total]).toEqual([800, SCORE.fullCombo, 3000 + 800 + 4000 + SCORE.win + SCORE.fullCombo]);
    const lose = sheetOf({ moves: 3000, discs: 20, won: false, perfect: false, maxCombo: 7 });
    expect([lose.win, lose.perfect, lose.total]).toEqual([0, 0, 3000 + 2000 + 1400]);
    expect(sheetOf({ moves: 0, discs: 64, won: true, perfect: true, maxCombo: 0 }).perfect).toBe(SCORE.perfect);
  });
});

describe('Combo', () => {
  test('手番が始まってから窓の中で打つと積み、最大を覚える', () => {
    const c = new Combo();
    for (let i = 0; i < 3; i++) {
      c.start(i * 10, true);
      expect(c.hit(i * 10 + COMBO_WINDOW).continued).toBe(true);
    }
    expect([c.count, c.best]).toEqual([3, 3]);
  });

  test('窓を過ぎると途切れ、途切れる前の数を 1 回だけ返す。遅れて打った手は数え直して 1 にする', () => {
    const c = new Combo();
    c.start(0, true);
    c.hit(1);
    c.start(5, true);
    expect(c.expire(5 + COMBO_WINDOW)).toBe(0);
    expect(c.remaining(5 + COMBO_WINDOW / 2)).toBeCloseTo(0.5, 9);
    expect(c.expire(5 + COMBO_WINDOW + 0.01)).toBe(1);
    expect(c.expire(20)).toBe(0);
    expect([c.count, c.remaining(9)]).toEqual([0, 0]);
    expect(c.hit(9).continued).toBe(false);
    expect([c.count, c.best]).toEqual([1, 1]);
  });

  test('途切れた後に打った手は新しいコンボの 1 手目になり、続く手はそこから積む', () => {
    const c = new Combo();
    c.start(0, true);
    c.hit(0.5);
    c.start(1, true);
    c.hit(1.5);
    c.start(2, true);
    expect(c.expire(2 + COMBO_WINDOW + 0.01)).toBe(2);
    expect(c.hit(6).continued).toBe(false);
    expect(c.count).toBe(1);
    c.start(7, true);
    expect(c.hit(7.5).continued).toBe(true);
    c.start(8, true);
    expect(c.hit(8.5).continued).toBe(true);
    expect([c.count, c.best]).toEqual([3, 3]);
  });

  test('窓を過ぎてから打つと、途切れを待たずにその手から数え直す', () => {
    const c = new Combo();
    c.start(0, true);
    c.hit(0.1);
    c.start(1, true);
    c.hit(1.1);
    c.start(2, true);
    expect(c.hit(2 + COMBO_WINDOW + 0.1).continued).toBe(false);
    expect([c.count, c.best]).toEqual([1, 2]);
  });

  test('フィーバーは start から始まり、full で最大になる', () => {
    expect(feverLevel(FEVER.start - 1)).toBe(0);
    expect(feverLevel(FEVER.start)).toBeGreaterThan(0);
    expect(feverLevel(FEVER.full)).toBe(1);
    expect(feverLevel(FEVER.full + 30)).toBe(1);
  });
});

describe('ScoreKeeper', () => {
  test('人の手の点を足す。角を取り、確定石が増えた手はその分も足す', () => {
    // 黒が a1 に打つと b1 を返す
    const p = positionFromRows(['.OX.....', '........', '...XO...', '...OX...', '........', '........', '........', '........'], BLACK);
    const keeper = new ScoreKeeper();
    const s = keeper.add(play(p, parseSquare('a1')), 3, 1, false);
    expect(s).toEqual(scoreMove({ flipped: 1, corner: true, stableGained: 3, combo: 1, quick: false }));
    const t = keeper.add(play(p, parseSquare('a1')), 0, 2, true);
    expect(keeper.total).toBe(s.total + t.total);
    // 早打ちの点は、手の点と分けて数える
    expect([keeper.moves, keeper.quick, keeper.quickCount]).toEqual([s.total + t.total - SCORE.quick, SCORE.quick, 1]);
  });
});

describe('Combo の途切れと早打ち', () => {
  test('最初の手から一度も途切れずに打ち続けたら、途切れていない（フルコンボの条件の 1 つ）', () => {
    const c = new Combo();
    expect(c.unbroken).toBe(false);
    for (let i = 0; i < 5; i++) {
      c.start(i * 10, true);
      c.hit(i * 10 + 1);
    }
    expect(c.unbroken).toBe(true);
  });

  test('窓を過ぎた（最初の手番でも）、窓の外で打った、人がパスした、のどれかがあれば、途切れたことになる', () => {
    const timedOut = new Combo();
    timedOut.start(0, true);
    timedOut.expire(COMBO_WINDOW + 0.01);
    timedOut.hit(5);
    expect(timedOut.unbroken).toBe(false);

    const late = new Combo();
    late.start(0, true);
    late.hit(COMBO_WINDOW + 0.01);
    expect(late.unbroken).toBe(false);

    const passed = new Combo();
    passed.start(0, true);
    passed.hit(1);
    expect(passed.pass()).toBe(1);
    passed.start(5, true);
    passed.hit(5.5);
    expect([passed.unbroken, passed.count]).toEqual([false, 1]);
  });

  test('人がパスしたら、窓を閉じてコンボを 0 にする（最大は残す）', () => {
    const c = new Combo();
    c.start(0, true);
    c.hit(0.5);
    c.start(1, true);
    c.hit(1.5);
    c.start(2, true);
    expect(c.pass()).toBe(2);
    expect([c.count, c.best, c.remaining(2.1)]).toEqual([0, 2, 0]);
    expect(c.pass()).toBe(0);
  });

  test('手番が始まってから QUICK_WINDOW 秒以内に打った手だけが早打ち。対局の最初の手番と、窓が閉じていれば早打ちにしない', () => {
    const c = new Combo();
    c.start(0, true);
    expect(c.hit(QUICK_WINDOW).quick).toBe(true);
    // 対局の最初の手番は、すぐに打っても早打ちにしない
    c.start(5, false);
    expect(c.hit(5)).toEqual({ continued: true, quick: false });
    c.start(10, true);
    expect(c.hit(10 + QUICK_WINDOW + 0.01)).toEqual({ continued: true, quick: false });
    expect(c.hit(20).quick).toBe(false);
  });
});

describe('Combo の終わり', () => {
  test('対局が終わったら窓を閉じ、今のコンボを 0 にして最大は残す', () => {
    const c = new Combo();
    for (let i = 0; i < 3; i++) {
      c.start(i, true);
      c.hit(i);
    }
    c.start(10, true);
    c.close();
    expect([c.count, c.best, c.remaining(10)]).toEqual([0, 3, 0]);
    expect(c.expire(100)).toBe(0);
  });
});
