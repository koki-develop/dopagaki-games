/*
 * 卓のワールド座標。x は左から右へ 0〜TABLE_W、y は下から上へ 0〜TABLE_H（上にディーラー、下にプレイヤー）。
 * いちばん手前（y が 0〜RACK_H）は、プレイヤーの手持ちのチップの山を並べる列。カードの位置はカードの中心。
 */

export const TABLE_W = 10;
export const TABLE_H = 14.5;
/** 手前の、手持ちのチップの山を並べる列の高さ */
export const RACK_H = 1.5;
/** 卓の左右に空ける最小の余白（CSS ピクセル） */
const SIDE_GUTTER = 8;

/** カードの大きさ（ワールド単位。縦横比は表の絵と同じ 2:3） */
export const CARD_W = 1.72;
export const CARD_H = 2.58;

/** ディーラーの手の中心の高さと、プレイヤーの手の中心の高さ */
export const DEALER_Y = RACK_H + 10.0;
export const PLAYER_Y = RACK_H + 5.0;
/**
 * 卓の奥に置く道具（中心と、半分の幅と高さ）。右にカードのシュー、真ん中にディーラーのチップラック。
 * どちらもディーラーのカードより奥に収まる
 */
export const SHOE = { x: 8.95, y: RACK_H + 12.35, hw: 0.82, hh: 0.56 } as const;
export const DEALER_TRAY = { x: 5, y: RACK_H + 12.4, hw: 1.95, hh: 0.5 } as const;
/** ラウンドを締めて片付けるカードを集める先（ディーラーの手元。卓の奥の端の上） */
export const COLLECT_CARDS = { x: TABLE_W / 2, y: TABLE_H + 0.6 } as const;

/**
 * チップの半径と厚み（ワールド単位）。チップは少し手前から見下ろしたように、上の面の円と、その下に厚みの側面を描く。
 * 積むときは 1 枚ごとに厚みの分だけ上へずらす
 */
export const CHIP_R = 0.5;
export const CHIP_THICKNESS = 0.085;
/** チップの山を置く高さ（手の中心から）と、払い戻しの山と並べるときの左右のずれ */
const STACK_Y = -2.6;
const STACK_SIDE = 0.55;

/**
 * チップの山の置き方。center は賭けの山だけのとき（賭けの丸の真ん中）、
 * 払い戻しの山が来たら、賭けの山を左（left）へずらし、払い戻しの山を右（right）に置く
 */
export type StackSpot = 'center' | 'left' | 'right';
const SIDE_OF: Readonly<Record<StackSpot, number>> = { center: 0, left: -1, right: 1 };
/** 賭けの丸の半径（手が 1 つのとき） */
const SPOT_R = 1.1;

/** 手の中で隣のカードとずらす量（カードの幅に対する割合）と、少し上へずらす量 */
const FAN_X = 0.32;
const FAN_Y = 0.06;
/** ディーラーの手は余裕があるので広げる */
const DEALER_FAN_X = 0.42;

export type Layout = {
  /** CSS ピクセル */
  width: number;
  height: number;
  /** 1 ワールド単位あたりの CSS ピクセル */
  pxPerUnit: number;
  /** ワールドの原点の、描画領域の左上からの CSS ピクセル位置 */
  originX: number;
  originY: number;
  /** カメラに映すワールド座標の範囲 */
  left: number;
  right: number;
  bottom: number;
  top: number;
};

/**
 * 画面に卓を収める配置を決める。上に topReservedPx、下に bottomReservedPx を空け、残りの領域の中央に置く。
 * 縦長の端末では幅に合わせ、横長の端末では高さに合わせる。
 */
export function computeLayout(width: number, height: number, topReservedPx: number, bottomReservedPx: number): Layout {
  const availW = Math.max(1, width - SIDE_GUTTER * 2);
  const availH = Math.max(1, height - topReservedPx - bottomReservedPx);
  const pxPerUnit = Math.max(1e-3, Math.min(availW / TABLE_W, availH / TABLE_H));
  const originX = (width - TABLE_W * pxPerUnit) / 2;
  const originY = topReservedPx + (availH + TABLE_H * pxPerUnit) / 2;
  const left = -originX / pxPerUnit;
  const right = left + width / pxPerUnit;
  const top = originY / pxPerUnit;
  const bottom = top - height / pxPerUnit;
  return { width, height, pxPerUnit, originX, originY, left, right, bottom, top };
}

/** ワールド座標の、描画領域の左上からの CSS ピクセル位置 */
export const toPxX = (l: Layout, x: number): number => l.originX + x * l.pxPerUnit;
export const toPxY = (l: Layout, y: number): number => l.originY - y * l.pxPerUnit;
/** 描画領域の左上からの CSS ピクセル位置の、ワールド座標 */
export const toWorldX = (l: Layout, px: number): number => (px - l.originX) / l.pxPerUnit;
export const toWorldY = (l: Layout, py: number): number => (l.originY - py) / l.pxPerUnit;

/** カード 1 枚の置き場所。rot はラジアン（ダブルした 1 枚は横に寝かせる） */
export type CardPlace = { x: number; y: number; rot: number; scale: number };

/** 手が count 個のときの、手のカードの大きさ */
export const handScale = (count: number): number => (count <= 2 ? 1 : count === 3 ? 0.82 : 0.7);

/** 手が count 個のときの、i 番目の手の中心の x */
export function handCenterX(i: number, count: number): number {
  const slot = Math.min(TABLE_W / Math.max(1, count), 5);
  return TABLE_W / 2 + (i - (count - 1) / 2) * slot;
}

/** 手が count 個のときの、1 つの手に使える幅（隣の手と重ならない幅） */
export const handSlotWidth = (count: number): number => Math.min(TABLE_W / Math.max(1, count), 5) - 0.25;

/** カードをずらす量。cards 枚が width に収まるように詰める */
function fanStep(cards: number, scale: number, width: number, step: number): number {
  if (cards <= 1) return 0;
  const want = CARD_W * scale * step;
  const fit = (width - CARD_W * scale) / (cards - 1);
  return Math.max(0.12 * scale, Math.min(want, fit));
}

/**
 * 手が count 個のときの、i 番目の手の k 番目（全 cards 枚）のカードの置き場所を out に書く。
 * sideways は、ダブルして引いた 1 枚（横に寝かせて、少し右へ離す）
 */
export function playerCardPlace(i: number, count: number, k: number, cards: number, sideways: boolean, out: CardPlace): CardPlace {
  const scale = handScale(count);
  const step = fanStep(cards, scale, handSlotWidth(count), FAN_X);
  const span = (cards - 1) * step;
  const cx = handCenterX(i, count);
  out.x = cx - span / 2 + k * step + (sideways ? CARD_W * scale * 0.12 : 0);
  out.y = PLAYER_Y + k * FAN_Y * scale - (sideways ? CARD_H * scale * 0.08 : 0);
  out.rot = sideways ? -Math.PI / 2 : 0;
  out.scale = scale;
  return out;
}

/** ディーラーの k 番目（全 cards 枚）のカードの置き場所を out に書く */
export function dealerCardPlace(k: number, cards: number, out: CardPlace): CardPlace {
  const step = fanStep(cards, 1, TABLE_W - 1, DEALER_FAN_X);
  const span = (cards - 1) * step;
  out.x = TABLE_W / 2 - span / 2 + k * step;
  out.y = DEALER_Y;
  out.rot = 0;
  out.scale = 1;
  return out;
}

/** 手が count 個のときの、i 番目の手の合計の札の位置（カードの上端の少し上） */
export function playerLabelX(i: number, count: number): number {
  return handCenterX(i, count);
}
export const playerLabelY = (count: number): number => PLAYER_Y + (CARD_H * handScale(count)) / 2 + 0.42;

/** ディーラーの合計の札の位置（カードの下端の少し下） */
export const DEALER_LABEL = { x: TABLE_W / 2, y: DEALER_Y - CARD_H / 2 - 0.42 } as const;

/**
 * 手が count 個のときの、i 番目の手の、spot に置いたチップの山の n 枚目（0 から）の位置を out に書く。
 * チップと賭けの丸は、手が増えてカードを小さくしても小さくせず、上下に動かさない（4 つの手でも、1 つの手の幅に 2 つの山と丸が収まる）
 */
export function chipPlace(i: number, count: number, n: number, spot: StackSpot, out: { x: number; y: number }): { x: number; y: number } {
  out.x = handCenterX(i, count) + SIDE_OF[spot] * STACK_SIDE;
  out.y = PLAYER_Y + STACK_Y + n * CHIP_THICKNESS;
  return out;
}

/** 手が count 個のときの、i 番目の手の賭けの丸（チップを置く場所）の中心と半径 */
export function betSpot(i: number, count: number, out: { x: number; y: number; r: number }): { x: number; y: number; r: number } {
  out.x = handCenterX(i, count);
  out.y = PLAYER_Y + STACK_Y;
  out.r = SPOT_R;
  return out;
}

/** 手持ちのチップの山の列の、山の底の高さと、隣の山との間（7 列で卓の幅に収まる） */
const RACK_Y = 0.62;
const RACK_STEP = 1.35;

/** 手持ちのチップの山が cols 列のときの、c 列目（左から）の山の n 枚目（0 から）の位置を out に書く。列は卓の真ん中にそろえる */
export function rackPlace(c: number, cols: number, n: number, out: { x: number; y: number }): { x: number; y: number } {
  out.x = TABLE_W / 2 + (c - (cols - 1) / 2) * RACK_STEP;
  out.y = RACK_Y + n * CHIP_THICKNESS;
  return out;
}

/** 手が count 個のときの、i 番目の手の賭けの額の札の中心（賭けの丸のすぐ下）を out に書く */
export function betLabelPlace(i: number, count: number, out: { x: number; y: number }): { x: number; y: number } {
  out.x = handCenterX(i, count);
  out.y = PLAYER_Y + STACK_Y - SPOT_R - 0.3;
  return out;
}

/** 手が count 個のときの、i 番目の手のまわりの範囲（中心と半分の大きさ）。操作を待つ手を光らせる */
export function handBounds(i: number, count: number, cards: number, out: { x: number; y: number; hw: number; hh: number }): typeof out {
  const scale = handScale(count);
  const step = fanStep(cards, scale, handSlotWidth(count), FAN_X);
  out.x = handCenterX(i, count);
  out.y = PLAYER_Y + ((cards - 1) * FAN_Y * scale) / 2;
  out.hw = (CARD_W * scale + (cards - 1) * step) / 2 + 0.2;
  out.hh = (CARD_H * scale) / 2 + 0.2 + ((cards - 1) * FAN_Y * scale) / 2;
  return out;
}
