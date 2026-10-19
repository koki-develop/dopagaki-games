import { PRESENT_LONG_AGO } from '../../../juice/frame-time.ts';
import { clamp01 } from '../../../shared/math.ts';
import type { CardPlace } from '../geometry.ts';

/** 卓に同時に出せるカードの枚数。1 ラウンドの場のカードはこれより多くならない（分けて 4 つの手でも 40 枚ほど） */
export const CARD_SLOTS = 64;
/** 1 枚あたりの値の数（vec4 が 6 本） */
export const CARD_LANES = 6;
export const CARD_STRIDE = CARD_LANES * 4;

/** カードの面。0〜51 はカードの表、BACK は裏 */
export const BACK = -1;

/** 光らせ方（glowKind） */
export const CardGlow = { None: 0, Win: 1, Blackjack: 2, TwentyOne: 3 } as const;
export type CardGlow = (typeof CardGlow)[keyof typeof CardGlow];

/**
 * 並び（1 枚ごとに CARD_STRIDE 個）:
 * - 0: 動き始めの位置 x, y、動いた先の位置 x, y
 * - 1: 動き始める時刻, 動く長さ, 動き始めの向き, 動いた先の向き（ラジアン）
 * - 2: 返し始める時刻, 返す長さ, 返す前の面, 返した後の面（BACK は裏）
 * - 3: 動き始めの大きさ, 動いた先の大きさ, 動く間の見かけの高さ, 出しているか（1 / 0）
 * - 4: 卓に着いた時刻, 暗くし始めた時刻, 光らせた時刻, 光らせ方（CardGlow）
 * - 5: 確かめ始めた時刻（ディーラーの伏せたカードの角を持ち上げる）, ヒットストップで震わせるか（1 / 0）, 消し始めた時刻, 確かめる長さ
 */
export const CARD_OFFSET = {
  fromX: 0,
  fromY: 1,
  toX: 2,
  toY: 3,
  moveStart: 4,
  moveDur: 5,
  fromRot: 6,
  toRot: 7,
  flipStart: 8,
  flipDur: 9,
  faceA: 10,
  faceB: 11,
  fromScale: 12,
  toScale: 13,
  lift: 14,
  visible: 15,
  landAt: 16,
  dimAt: 17,
  glowAt: 18,
  glowKind: 19,
  peekAt: 20,
  shake: 21,
  fadeAt: 22,
  peekDur: 23,
} as const;

const O = CARD_OFFSET;

/** 動きの進み具合 k（0〜1）の、位置・向き・大きさの進み具合。シェーダー（view/cards.ts）も同じ式で動かす */
export const moveEase = (k: number): number => 1 - (1 - k) ** 3;

/**
 * 卓のカードの見た目の状態。演出（ディレクター）が書き、描画（CardsView）が版（version）の変わったときに写す。
 * 時刻はすべて present の時間軸（シェーダーの u.time）の秒。シェーダーが時刻から動きを計算するので、毎フレーム書く必要はない。
 * 1 枚のカードは 1 つの枠（slot）を使い、配った順に枠を割り当てる。枠の順に描くので、後から配ったカードが上に重なる。
 */
export class CardField {
  readonly data = new Float32Array(CARD_SLOTS * CARD_STRIDE);
  version = 0;

  constructor() {
    this.clear();
  }

  /** すべてのカードを消す */
  clear(): void {
    for (let s = 0; s < CARD_SLOTS; s++) this.reset(s);
    this.version++;
  }

  /** 枠 slot のカードを、時刻 at から duration かけて from から to へ動かす。見かけの高さ lift の弧を描く */
  fly(slot: number, from: Readonly<CardPlace>, to: Readonly<CardPlace>, at: number, duration: number, lift: number): void {
    const d = this.data;
    const o = slot * CARD_STRIDE;
    d[o + O.fromX] = from.x;
    d[o + O.fromY] = from.y;
    d[o + O.fromRot] = from.rot;
    d[o + O.fromScale] = from.scale;
    d[o + O.toX] = to.x;
    d[o + O.toY] = to.y;
    d[o + O.toRot] = to.rot;
    d[o + O.toScale] = to.scale;
    d[o + O.moveStart] = at;
    d[o + O.moveDur] = duration;
    d[o + O.lift] = lift;
    d[o + O.visible] = 1;
    this.version++;
  }

  /** 枠 slot のカードを、時刻 at のその場所から、duration かけて to へ滑らせる（弧を描かない） */
  slide(slot: number, to: Readonly<CardPlace>, at: number, duration: number): void {
    const from = this.placeAt(slot, at, scratch);
    this.fly(slot, from, to, at, duration, 0);
  }

  /** 枠 slot のカードの面を face にする（返さずに。配る前に裏で用意するとき） */
  setFace(slot: number, face: number): void {
    const o = slot * CARD_STRIDE;
    this.data[o + O.faceA] = face;
    this.data[o + O.faceB] = face;
    this.data[o + O.flipStart] = PRESENT_LONG_AGO;
    this.version++;
  }

  /** 枠 slot のカードを、時刻 at から duration かけて、今の面から face へ返す */
  flip(slot: number, face: number, at: number, duration: number): void {
    const d = this.data;
    const o = slot * CARD_STRIDE;
    d[o + O.faceA] = this.faceAt(slot, at);
    d[o + O.faceB] = face;
    d[o + O.flipStart] = at;
    d[o + O.flipDur] = duration;
    this.version++;
  }

  /** 卓に着いた（叩きつけた瞬間の弾みと光） */
  landed(slot: number, at: number): void {
    this.data[slot * CARD_STRIDE + O.landAt] = at;
    this.version++;
  }

  /** 時刻 at から暗くする（バーストした手と、負けた手） */
  dim(slot: number, at: number): void {
    this.data[slot * CARD_STRIDE + O.dimAt] = at;
    this.version++;
  }

  /** 時刻 at から kind の光をまとう */
  glow(slot: number, at: number, kind: CardGlow): void {
    const o = slot * CARD_STRIDE;
    this.data[o + O.glowAt] = at;
    this.data[o + O.glowKind] = kind;
    this.version++;
  }

  /** 時刻 at から duration かけて、伏せたカードの角を持ち上げて確かめ、元に戻す */
  peek(slot: number, at: number, duration: number): void {
    const o = slot * CARD_STRIDE;
    this.data[o + O.peekAt] = at;
    this.data[o + O.peekDur] = duration;
    this.version++;
  }

  /** ヒットストップで震わせるか */
  setShake(slot: number, on: boolean): void {
    const o = slot * CARD_STRIDE + O.shake;
    const v = on ? 1 : 0;
    if (this.data[o] === v) return;
    this.data[o] = v;
    this.version++;
  }

  /** 時刻 at から薄くして消す（捨てたカード） */
  fade(slot: number, at: number): void {
    this.data[slot * CARD_STRIDE + O.fadeAt] = at;
    this.version++;
  }

  /** 枠 slot のカードの、時刻 t の場所 */
  placeAt(slot: number, t: number, out: CardPlace): CardPlace {
    const d = this.data;
    const o = slot * CARD_STRIDE;
    const k = clamp01((t - d[o + O.moveStart]) / Math.max(1e-3, d[o + O.moveDur]));
    const e = moveEase(k);
    out.x = d[o + O.fromX] + (d[o + O.toX] - d[o + O.fromX]) * e;
    out.y = d[o + O.fromY] + (d[o + O.toY] - d[o + O.fromY]) * e;
    out.rot = d[o + O.fromRot] + (d[o + O.toRot] - d[o + O.fromRot]) * e;
    out.scale = d[o + O.fromScale] + (d[o + O.toScale] - d[o + O.fromScale]) * e;
    return out;
  }

  /** 枠 slot のカードの、時刻 t に見えている面（返している途中は、半分を過ぎたら返した後の面） */
  faceAt(slot: number, t: number): number {
    const d = this.data;
    const o = slot * CARD_STRIDE;
    const start = d[o + O.flipStart];
    if (t < start + d[o + O.flipDur] / 2) return d[o + O.faceA];
    return d[o + O.faceB];
  }

  /** 枠 slot を出しているか */
  isVisible(slot: number): boolean {
    return this.data[slot * CARD_STRIDE + O.visible] === 1;
  }

  private reset(s: number): void {
    const d = this.data;
    const o = s * CARD_STRIDE;
    d.fill(0, o, o + CARD_STRIDE);
    d[o + O.moveStart] = PRESENT_LONG_AGO;
    d[o + O.moveDur] = 1;
    d[o + O.fromScale] = 1;
    d[o + O.toScale] = 1;
    d[o + O.flipStart] = PRESENT_LONG_AGO;
    d[o + O.flipDur] = 1;
    d[o + O.faceA] = BACK;
    d[o + O.faceB] = BACK;
    d[o + O.landAt] = PRESENT_LONG_AGO;
    d[o + O.dimAt] = PRESENT_LONG_AGO;
    d[o + O.glowAt] = PRESENT_LONG_AGO;
    d[o + O.peekAt] = PRESENT_LONG_AGO;
    d[o + O.peekDur] = 1;
    d[o + O.fadeAt] = PRESENT_LONG_AGO;
  }
}

/** slide が今の場所を読む入れ物 */
const scratch: CardPlace = { x: 0, y: 0, rot: 0, scale: 1 };
