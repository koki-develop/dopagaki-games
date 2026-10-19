import { describe, expect, test } from 'bun:test';
import { RACK_CAP, RACK_COLUMNS } from './denominations.ts';
import { betLabelPlace, betSpot, CARD_H, CARD_W, CHIP_R, chipPlace, CHIP_THICKNESS, computeLayout, dealerCardPlace, handCenterX, handScale, PLAYER_Y, playerCardPlace, RACK_H, rackPlace, TABLE_H, TABLE_W, toPxX, toPxY, toWorldX, toWorldY } from './geometry.ts';
import type { CardPlace } from './geometry.ts';
import { MAX_HANDS } from './rules/round.ts';

const place = (): CardPlace => ({ x: 0, y: 0, rot: 0, scale: 1 });

describe('computeLayout', () => {
  test('卓を上下の余白の間に収め、幅 320px でも横にはみ出さない', () => {
    for (const [w, h] of [
      [320, 568],
      [390, 844],
      [1280, 720],
    ]) {
      const l = computeLayout(w, h, 100, 140);
      expect(toPxX(l, 0)).toBeGreaterThanOrEqual(0);
      expect(toPxX(l, TABLE_W)).toBeLessThanOrEqual(w);
      expect(toPxY(l, TABLE_H)).toBeGreaterThanOrEqual(100 - 1e-9);
      expect(toPxY(l, 0)).toBeLessThanOrEqual(h - 140 + 1e-9);
      expect(toWorldX(l, toPxX(l, 3))).toBeCloseTo(3, 9);
      expect(toWorldY(l, toPxY(l, 4))).toBeCloseTo(4, 9);
    }
  });
});

describe('カードの置き場所', () => {
  test('どの手の数・枚数でも、手のカードは卓の幅に収まり、隣の手と重ならない', () => {
    for (let count = 1; count <= MAX_HANDS; count++) {
      for (let cards = 1; cards <= 11; cards++) {
        let prevRight = -Infinity;
        for (let i = 0; i < count; i++) {
          const half = (CARD_W * handScale(count)) / 2;
          const first = playerCardPlace(i, count, 0, cards, false, place());
          const last = playerCardPlace(i, count, cards - 1, cards, false, place());
          expect(first.x - half).toBeGreaterThanOrEqual(-1e-9);
          expect(last.x + half).toBeLessThanOrEqual(TABLE_W + 1e-9);
          expect(first.x - half).toBeGreaterThan(prevRight);
          prevRight = last.x + half;
          expect(last.x).toBeGreaterThanOrEqual(first.x);
        }
      }
    }
    expect(handCenterX(0, 1)).toBe(TABLE_W / 2);
  });

  test('ダブルして引いた 1 枚は横に寝かせる。ディーラーのカードは卓の中央に広げる', () => {
    expect(playerCardPlace(0, 1, 2, 3, true, place()).rot).toBeCloseTo(-Math.PI / 2, 9);
    const a = dealerCardPlace(0, 2, place());
    const b = dealerCardPlace(1, 2, place());
    expect((a.x + b.x) / 2).toBeCloseTo(TABLE_W / 2, 9);
    for (let n = 1; n <= 10; n++) {
      expect(dealerCardPlace(0, n, place()).x - CARD_W / 2).toBeGreaterThanOrEqual(0);
      expect(dealerCardPlace(n - 1, n, place()).x + CARD_W / 2).toBeLessThanOrEqual(TABLE_W);
    }
  });
});

describe('チップの山と賭けの丸', () => {
  test('どの手の数でも、賭けの丸は卓の幅に収まって隣の丸と重ならず、2 つの山の底は丸の中にある', () => {
    const spot = { x: 0, y: 0, r: 0 };
    const at = { x: 0, y: 0 };
    for (let count = 1; count <= MAX_HANDS; count++) {
      let prevRight = -Infinity;
      for (let i = 0; i < count; i++) {
        betSpot(i, count, spot);
        expect(spot.x - spot.r).toBeGreaterThanOrEqual(0);
        expect(spot.x + spot.r).toBeLessThanOrEqual(TABLE_W);
        expect(spot.x - spot.r).toBeGreaterThan(prevRight);
        prevRight = spot.x + spot.r;
        for (const side of ['center', 'left', 'right'] as const) {
          chipPlace(i, count, 0, side, at);
          expect(Math.hypot(at.x - spot.x, at.y - spot.y) + CHIP_R).toBeLessThanOrEqual(spot.r + 1e-9);
        }
        // 賭けの額の札は丸の下で、卓の下端より上
        betLabelPlace(i, count, at);
        expect(at.y).toBeLessThan(spot.y - spot.r);
        expect(at.y).toBeGreaterThan(0.3);
      }
    }
  });

  test('10 枚までの山の上のチップは、カードの下端にかからない（それより高い山は、本物の卓と同じくカードの手前に重なる）', () => {
    const at = { x: 0, y: 0 };
    for (let count = 1; count <= MAX_HANDS; count++) {
      chipPlace(0, count, 9, 'center', at);
      expect(at.y + CHIP_R).toBeLessThanOrEqual(PLAYER_Y - (CARD_H * handScale(count)) / 2 + 0.2);
    }
  });
});

describe('手持ちのチップの山の列', () => {
  test('どの列の数でも、山は卓の幅に収まって隣の山と重ならず、10 枚積んでも手前の列の中にあり、賭けの札より下', () => {
    const at = { x: 0, y: 0 };
    const label = { x: 0, y: 0 };
    betLabelPlace(0, 1, label);
    for (let cols = 1; cols <= RACK_COLUMNS; cols++) {
      let prevRight = -Infinity;
      for (let c = 0; c < cols; c++) {
        rackPlace(c, cols, 0, at);
        expect(at.x - CHIP_R).toBeGreaterThanOrEqual(0);
        expect(at.x + CHIP_R).toBeLessThanOrEqual(TABLE_W);
        expect(at.x - CHIP_R).toBeGreaterThan(prevRight);
        prevRight = at.x + CHIP_R;
        // 底のチップの側面まで卓の下端より上
        expect(at.y - CHIP_R - CHIP_THICKNESS).toBeGreaterThanOrEqual(0);
        rackPlace(c, cols, RACK_CAP - 1, at);
        expect(at.y + CHIP_R).toBeLessThanOrEqual(RACK_H + 0.5);
        expect(at.y + CHIP_R).toBeLessThan(label.y - 0.3);
      }
    }
  });
});
