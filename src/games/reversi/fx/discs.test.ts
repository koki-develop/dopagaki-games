import { describe, expect, test } from 'bun:test';
import { cellX, cellY } from '../geometry.ts';
import type { Bits } from '../rules/bits.ts';
import { BLACK, initialPosition, SQUARES, WHITE } from '../rules/position.ts';
import { DISC_OFFSET, DISC_STRIDE, DiscField, DropKind, FAR_AHEAD, LONG_AGO } from './discs.ts';

const O = DISC_OFFSET;

/** マス s だけの集合 */
const only = (s: number): Bits => (s < 32 ? { hi: 0, lo: (1 << s) >>> 0 } : { hi: (1 << (s - 32)) >>> 0, lo: 0 });

/** マス s の値 key */
const lane = (d: DiscField, s: number, key: keyof typeof DISC_OFFSET): number => d.data[s * DISC_STRIDE + O[key]];

describe('起きていない出来事の時刻', () => {
  test('シェーダーが足す 0.1 秒の幅が、f32 で丸め消えない', () => {
    for (const t of [LONG_AGO, FAR_AHEAD]) {
      expect(Math.fround(t + 0.1)).toBeGreaterThan(Math.fround(t));
    }
  });
});

describe('DiscField', () => {
  test('値の並びは、描画（view/discs.ts）が vec4 の 6 本として読む位置のとおり。空きは 1 つだけ', () => {
    expect(DISC_STRIDE).toBe(24);
    const lanes = [
      ['x', 'y', 'from', 'to'],
      ['flipStart', 'flipDur', 'spins', 'lift'],
      ['dirX', 'dirY', 'dropStart', 'dropKind'],
      ['moveFromX', 'moveFromY', 'moveStart', null],
      ['legalSince', 'legalUntil', 'previewSince', 'stableSince'],
      ['previewKind', 'dropDur', 'countedAt', 'dimAt'],
    ] as const;
    lanes.forEach((names, k) => names.forEach((name, i) => name !== null && expect<number>(O[name]).toBe(k * 4 + i)));
    expect(Object.keys(O)).toHaveLength(DISC_STRIDE - 1);
    expect(new Set(Object.values(O)).size).toBe(DISC_STRIDE - 1);
  });

  test('空の盤は、石も印もなく、どの出来事もまだ起きていない', () => {
    const d = new DiscField();
    for (let s = 0; s < SQUARES; s++) {
      expect([lane(d, s, 'x'), lane(d, s, 'y')]).toEqual([cellX(s), cellY(s)]);
      expect([lane(d, s, 'from'), lane(d, s, 'to'), d.shown[s]]).toEqual([-1, -1, -1]);
      for (const k of ['flipStart', 'dropStart', 'moveStart', 'legalSince', 'legalUntil', 'previewSince', 'stableSince', 'countedAt', 'dimAt'] as const) {
        expect(lane(d, s, k)).toBe(LONG_AGO);
      }
      expect([lane(d, s, 'moveFromX'), lane(d, s, 'moveFromY')]).toEqual([cellX(s), cellY(s)]);
    }
  });

  test('局面どおりに置くと、盤に見える色もそろう', () => {
    const d = new DiscField();
    d.setPosition(initialPosition());
    expect([d.countShown(BLACK), d.countShown(WHITE)]).toEqual([2, 2]);
  });

  test('落とした石は、着いたと知らせるまで盤に見えない', () => {
    const d = new DiscField();
    const v = d.version;
    d.drop(19, BLACK, 3, 0.1, DropKind.Human);
    expect(d.version).toBeGreaterThan(v);
    expect([lane(d, 19, 'from'), lane(d, 19, 'to'), lane(d, 19, 'dropStart'), lane(d, 19, 'dropDur'), lane(d, 19, 'dropKind')]).toEqual([
      BLACK,
      BLACK,
      3,
      Math.fround(0.1),
      DropKind.Human,
    ]);
    expect(d.shown[19]).toBe(-1);
    d.landed(19, BLACK);
    expect(d.shown[19]).toBe(BLACK);
  });

  test('返る石は、返りきったと知らせるまで元の色に見える', () => {
    const d = new DiscField();
    d.setPosition(initialPosition());
    const s = 27;
    const before = d.shown[s];
    d.flip(s, WHITE, BLACK, 2, 0.2, 1, 0.5, 0, -1);
    expect([lane(d, s, 'from'), lane(d, s, 'to'), lane(d, s, 'flipStart'), lane(d, s, 'spins'), lane(d, s, 'dirX'), lane(d, s, 'dirY')]).toEqual([WHITE, BLACK, 2, 1, 0, -1]);
    expect(d.shown[s]).toBe(before);
  });

  test('合法手の印は、変わったマスだけ時刻を書く。消した印はその時刻からフェードする', () => {
    const d = new DiscField();
    d.setLegal(only(19), 1);
    expect([lane(d, 19, 'legalSince'), lane(d, 19, 'legalUntil')]).toEqual([1, FAR_AHEAD]);
    const v = d.version;
    d.setLegal(only(19), 2);
    expect(d.version).toBe(v);
    expect(lane(d, 19, 'legalSince')).toBe(1);
    d.clearLegal(3);
    expect([lane(d, 19, 'legalSince'), lane(d, 19, 'legalUntil')]).toEqual([1, 3]);
    // 石を落としたマスの印も、その時刻から消える
    d.setLegal(only(20), 4);
    d.drop(20, WHITE, 5, 0.1, DropKind.Cpu);
    expect(lane(d, 20, 'legalUntil')).toBe(5);
  });

  test('押している間の予告は、半透明の石と返る石の震えを書き、次の予告で前の予告を消す', () => {
    const d = new DiscField();
    d.preview(19, WHITE, [{ square: 27, dirX: 1, dirY: 0 }], 4);
    expect([lane(d, 19, 'previewKind'), lane(d, 19, 'previewSince')]).toEqual([3, 4]);
    expect([lane(d, 27, 'previewKind'), lane(d, 27, 'dirX'), lane(d, 27, 'dirY')]).toEqual([1, 1, 0]);
    d.preview(20, BLACK, [], 5);
    expect([lane(d, 19, 'previewKind'), lane(d, 27, 'previewKind'), lane(d, 20, 'previewKind')]).toEqual([0, 0, 2]);
    d.preview(-1, BLACK, [], 6);
    expect(lane(d, 20, 'previewKind')).toBe(0);
  });

  test('確定石の光は、最初に確定した時刻のまま', () => {
    const d = new DiscField();
    d.stable(0, 2);
    d.stable(0, 5);
    expect(lane(d, 0, 'stableSince')).toBe(2);
  });

  test('並べ直しは、元の位置と移す時刻を書き、移した先の色をすぐ盤に見える色にする', () => {
    const d = new DiscField();
    d.gather(0, WHITE, 3.5, 4.5, 7);
    expect([lane(d, 0, 'moveFromX'), lane(d, 0, 'moveFromY'), lane(d, 0, 'moveStart')]).toEqual([3.5, 4.5, 7]);
    expect([lane(d, 0, 'from'), lane(d, 0, 'to'), d.shown[0]]).toEqual([WHITE, WHITE, WHITE]);
    d.counted(0, 8);
    d.dim(0, 9);
    expect([lane(d, 0, 'countedAt'), lane(d, 0, 'dimAt')]).toEqual([8, 9]);
    d.clear();
    expect([lane(d, 0, 'moveStart'), lane(d, 0, 'countedAt'), lane(d, 0, 'dimAt'), d.shown[0]]).toEqual([LONG_AGO, LONG_AGO, LONG_AGO, -1]);
  });

  test('動きなしで置いた石は、移し始めが LONG_AGO のまま（描画では、とうに現れきった石）で、盤に見える色になる', () => {
    const d = new DiscField();
    d.gather(5, BLACK, 1, 2, 7);
    d.place(5, WHITE);
    expect([lane(d, 5, 'moveStart'), lane(d, 5, 'moveFromX'), lane(d, 5, 'moveFromY')]).toEqual([LONG_AGO, cellX(5), cellY(5)]);
    expect([lane(d, 5, 'from'), lane(d, 5, 'to'), d.shown[5]]).toEqual([WHITE, WHITE, WHITE]);
  });
});
