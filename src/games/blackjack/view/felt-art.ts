import { DEALER_TRAY, DEALER_Y, RACK_H, SHOE, TABLE_H, TABLE_W } from '../geometry.ts';
import { CARD_INK, CHIP_COLORS, FELT_PRINT } from './palette.ts';

/*
 * 卓のフェルトに印刷した模様と、卓に置いてある道具。地のフェルトは背景（background.ts）が描き、ここは透明な地の上に描く。
 * - ディーラーとプレイヤーの間の弧に「BLACKJACK PAYS 3 TO 2」と「DEALER MUST STAND ON ALL 17s」、それを挟む細い線
 * - 手前の、手持ちのチップの山を並べる列との境の線
 * - 奥の真ん中にディーラーのチップラック、右にカードのシュー
 * 印刷と道具は別々の画像に描く。three.js には触れず、描く手順だけを持つ（テクスチャにするのは table.ts）。
 */

/** 卓の四角形の、卓の外へ広げる余白（ワールド単位）と、1 ワールド単位あたりのピクセル */
export const FELT_PAD = 2;
export const FELT_PX = 100;
export const FELT_W = (TABLE_W + FELT_PAD * 2) * FELT_PX;
export const FELT_H = (TABLE_H + FELT_PAD * 2) * FELT_PX;

/** 弧の中心（ワールド座標）と、文字と線の半径 */
const ARC = { x: TABLE_W / 2, y: DEALER_Y + 7, title: 9.28, rule: 9.78, inner: 8.82, outer: 10.2 } as const;
/** 弧を描く角度の範囲（真下から左右へ、ラジアン） */
const ARC_SPAN = 0.62;

type Ctx = CanvasRenderingContext2D;

const px = (x: number): number => (x + FELT_PAD) * FELT_PX;
const py = (y: number): number => (TABLE_H + FELT_PAD - y) * FELT_PX;

/** フェルトの印刷（金の線と文字）を描く。演出で光らせたり虹色にしたりするのは、この印刷だけ */
export function paintFeltPrint(ctx: Ctx): void {
  ctx.clearRect(0, 0, FELT_W, FELT_H);
  paintArcPrint(ctx);
  paintRackLine(ctx);
}

/** 卓に置いてある道具（チップラック・シュー）を描く */
export function paintTableProps(ctx: Ctx): void {
  ctx.clearRect(0, 0, FELT_W, FELT_H);
  paintChipRack(ctx);
  paintShoe(ctx);
}

/** 弧に沿って text を描く。半径 r（ワールド単位）の円の、真下の位置を中心にして左から右へ並べる */
function arcText(ctx: Ctx, text: string, r: number, font: string, spacing: number): void {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = FELT_PRINT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const radius = r * FELT_PX;
  const widths = [...text].map((ch) => ctx.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0);
  let at = -total / 2;
  ctx.translate(px(ARC.x), py(ARC.y));
  for (let i = 0; i < text.length; i++) {
    const mid = at + widths[i] / 2;
    const angle = mid / radius;
    ctx.save();
    ctx.rotate(-angle);
    ctx.translate(0, radius);
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
    at += widths[i];
  }
  ctx.restore();
}

function arcLine(ctx: Ctx, r: number, width: number): void {
  ctx.beginPath();
  ctx.arc(px(ARC.x), py(ARC.y), r * FELT_PX, Math.PI / 2 - ARC_SPAN, Math.PI / 2 + ARC_SPAN);
  ctx.strokeStyle = FELT_PRINT;
  ctx.lineWidth = width;
  ctx.stroke();
}

function paintArcPrint(ctx: Ctx): void {
  arcLine(ctx, ARC.inner, 3);
  arcLine(ctx, ARC.outer, 3);
  arcLine(ctx, ARC.outer + 0.08, 1.2);
  arcText(ctx, 'BLACKJACK PAYS 3 TO 2', ARC.title, 'bold 40px "Times New Roman", Times, "Noto Serif", serif', 5);
  arcText(ctx, 'DEALER MUST STAND ON ALL 17s', ARC.rule, 'bold 22px "Helvetica Neue", Arial, "Noto Sans", sans-serif', 4);
}

/** ディーラーのチップラックの列ごとの額面（CHIP_VALUES の添字、左から）と、チップの詰まり具合（0〜1） */
const TRAY_COLUMNS = [6, 5, 4, 3, 3, 2, 1, 0] as const;
const TRAY_FILL = [0.55, 0.8, 0.9, 1, 0.95, 0.85, 0.75, 0.7] as const;
/** チップラックの列に横たわるチップ 1 枚の厚み（ピクセル） */
const TRAY_SLICE = 6;

/**
 * ディーラーのチップラック: 金属の盆に、額面ごとの細長い溝が並び、溝の中にチップが縁を上にして詰まっている。
 * 上から見ると、チップは溝を横切る細い帯で、帯は円柱のように真ん中が明るく、縁の模様が白い短い線で見える
 */
function paintChipRack(ctx: Ctx): void {
  const w = DEALER_TRAY.hw * 2 * FELT_PX;
  const h = DEALER_TRAY.hh * 2 * FELT_PX;
  const x = px(DEALER_TRAY.x) - w / 2;
  const y = py(DEALER_TRAY.y) - h / 2;
  // 盆: 落ちる影、金属の地、上の縁の光
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  const body = ctx.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, '#3a3f44');
  body.addColorStop(0.5, '#1d2023');
  body.addColorStop(1, '#0c0d0f');
  ctx.fillStyle = body;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 11);
  ctx.stroke();
  const columns = TRAY_COLUMNS.length;
  const pad = 9;
  const gap = 5;
  const tw = (w - pad * 2 - gap * (columns - 1)) / columns;
  const th = h - pad * 2;
  for (let c = 0; c < columns; c++) {
    const tx = x + pad + c * (tw + gap);
    const ty = y + pad;
    // 溝: 暗い底と、内側の影
    ctx.fillStyle = '#060708';
    roundRect(ctx, tx, ty, tw, th, tw / 2);
    ctx.fill();
    ctx.save();
    roundRect(ctx, tx, ty, tw, th, tw / 2);
    ctx.clip();
    const color = CHIP_COLORS[TRAY_COLUMNS[c]];
    const filled = Math.floor((th / TRAY_SLICE) * TRAY_FILL[c]);
    for (let k = 0; k < filled; k++) {
      const sy = ty + th - (k + 1) * TRAY_SLICE;
      // 横たわったチップの縁: 地の色を、溝の幅の向きに円柱のように明るさを変えて塗る
      const g = ctx.createLinearGradient(tx, 0, tx + tw, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.18)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = color.base;
      ctx.fillRect(tx, sy, tw, TRAY_SLICE - 1);
      ctx.fillStyle = g;
      ctx.fillRect(tx, sy, tw, TRAY_SLICE - 1);
      // 縁の模様: チップごとに回りかたが違うので、見える位置をずらす
      const spot = ((k * 7 + c * 3) % 5) / 5;
      ctx.fillStyle = color.spot;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(tx + tw * (0.15 + spot * 0.6), sy + 1, tw * 0.14, TRAY_SLICE - 3);
      ctx.globalAlpha = 1;
      // チップどうしの境目
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(tx, sy + TRAY_SLICE - 1, tw, 1);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    roundRect(ctx, tx + 0.5, ty + 0.5, tw - 1, th - 1, tw / 2);
    ctx.stroke();
  }
}

/**
 * カードのシュー: 黒い樹脂の箱を、口が卓の真ん中を向くように少し回して置く。
 * 上面の暗い窓から、詰まったカードの裏が透けて見え、右の側面にカードの縁の層、奥にカードを押さえる重り、手前の口から 1 枚目の端が覗く
 */
function paintShoe(ctx: Ctx): void {
  const w = SHOE.hw * 2 * FELT_PX;
  const h = SHOE.hh * 2 * FELT_PX;
  ctx.save();
  ctx.translate(px(SHOE.x), py(SHOE.y));
  ctx.rotate(-0.28);
  ctx.translate(-w / 2, -h / 2);
  // 口から覗く 1 枚目（箱の下に描く）: 白い縁と赤い格子のカードの裏
  ctx.save();
  ctx.translate(-14, h * 0.5);
  cardBack(ctx, -6, -h * 0.36, 44, h * 0.72);
  ctx.restore();
  // 箱: 落ちる影と、上からの光の当たった黒い樹脂
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 7;
  const body = ctx.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, '#34383c');
  body.addColorStop(0.45, '#16181a');
  body.addColorStop(1, '#070809');
  ctx.fillStyle = body;
  roundRect(ctx, 6, 0, w - 6, h, 14);
  ctx.fill();
  ctx.restore();
  // 口の前板: 手前へ下る傾斜の板と、指をかける半円の切り欠き（切り欠きから 1 枚目の裏が見える）
  const plate = ctx.createLinearGradient(6, 0, 34, 0);
  plate.addColorStop(0, '#5a6067');
  plate.addColorStop(1, '#25282c');
  ctx.fillStyle = plate;
  roundRect(ctx, 6, 4, 28, h - 8, 10);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(8, h / 2, h * 0.2, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  ctx.clip();
  cardBack(ctx, -20, h * 0.14, 44, h * 0.72);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(8, h / 2, h * 0.2, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.moveTo(34, 8);
  ctx.lineTo(34, h - 8);
  ctx.stroke();
  // 上面の窓: 詰まったカードの裏が、煙った樹脂越しに透けて見える
  const wx = 40;
  const wy = 12;
  const ww = w - 84;
  const wh = h - 24;
  ctx.save();
  roundRect(ctx, wx, wy, ww, wh, 6);
  ctx.clip();
  ctx.fillStyle = CARD_INK.back;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.strokeStyle = CARD_INK.backLine;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let d = -wh; d < ww + wh; d += 7) {
    ctx.moveTo(wx + d, wy);
    ctx.lineTo(wx + d + wh, wy + wh);
    ctx.moveTo(wx + d, wy + wh);
    ctx.lineTo(wx + d + wh, wy);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(8,8,10,0.45)';
  ctx.fillRect(wx, wy, ww, wh);
  const gloss = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
  gloss.addColorStop(0.2, 'rgba(255,255,255,0)');
  gloss.addColorStop(0.35, 'rgba(255,255,255,0.22)');
  gloss.addColorStop(0.45, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 2;
  roundRect(ctx, wx, wy, ww, wh, 6);
  ctx.stroke();
  // 右の側面に見えるカードの縁の層
  ctx.strokeStyle = 'rgba(251,250,245,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 0; k < 9; k++) {
    const lx = wx + ww + 4 + k * 2.2;
    ctx.moveTo(lx, wy + 4);
    ctx.lineTo(lx, wy + wh - 4);
  }
  ctx.stroke();
  // 奥の重り: 溝の刻まれた灰色の塊
  const bx = w - 20;
  ctx.fillStyle = '#3b3f44';
  roundRect(ctx, bx, 14, 12, h - 28, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  for (let k = 1; k < 6; k++) {
    const ly = 14 + ((h - 28) * k) / 6;
    ctx.moveTo(bx + 2, ly);
    ctx.lineTo(bx + 10, ly);
  }
  ctx.stroke();
  // 箱の縁の光
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, 7.5, 1.5, w - 9, h - 3, 13);
  ctx.stroke();
  ctx.restore();
}

/** 手前の、手持ちのチップの山を並べる列との境の金の線 */
function paintRackLine(ctx: Ctx): void {
  ctx.strokeStyle = FELT_PRINT;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(px(0.2), py(RACK_H));
  ctx.lineTo(px(TABLE_W - 0.2), py(RACK_H));
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px(0.2), py(RACK_H) + 7);
  ctx.lineTo(px(TABLE_W - 0.2), py(RACK_H) + 7);
  ctx.stroke();
}

/** カードの裏（白い縁の中に赤い地と格子）を (x, y) から w × h で描く */
function cardBack(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#fbfaf5';
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  const m = 4;
  ctx.save();
  roundRect(ctx, x + m, y + m, w - m * 2, h - m * 2, 2);
  ctx.clip();
  ctx.fillStyle = CARD_INK.back;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = CARD_INK.backLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = -h; d < w + h; d += 5) {
    ctx.moveTo(x + d, y);
    ctx.lineTo(x + d + h, y + h);
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 4);
  ctx.stroke();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
