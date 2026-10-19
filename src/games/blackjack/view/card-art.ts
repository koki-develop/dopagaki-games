import { DECK_SIZE, Suit } from '../rules/cards.ts';
import * as THREE from 'three/webgpu';
import { FACE_CORNER, FACE_H, FACE_W } from './card-faces.ts';
import type { CardFaces } from './card-faces.ts';
import { paintedTexture, repaintTexture } from './canvas.ts';
import { CARD_INK } from './palette.ts';

/*
 * トランプの絵柄。カード 52 枚の表と裏を、1 枚の画像（アトラス）に Canvas 2D で描く。
 * 表はイギリス式のトランプの SVG（card-faces.ts で読み込む）を写し、裏は白い縁の中に赤い格子を描く。
 * テクスチャにするのは createCardAtlas（CardsView が作って持つ）で、表は読み込んだ後に paintCardFaces で描き足す。
 */

/** カード 1 枚の大きさ（ピクセル。縦横比は表の SVG と同じ 2:3） */
export const CELL_W = 226;
export const CELL_H = 339;
/** アトラスの並び（横 9 枚 × 縦 6 段。WebGL2 で必ず使える 2048 ピクセル以内） */
export const ATLAS_COLS = 9;
export const ATLAS_ROWS = 6;
export const ATLAS_W = CELL_W * ATLAS_COLS;
export const ATLAS_H = CELL_H * ATLAS_ROWS;
/** 裏の絵を置く番号（表は 0〜51） */
export const BACK_CELL = DECK_SIZE;
/** カードの角の丸みの半径の、幅に対する割合（表の SVG の丸みに合わせる。シェーダーもこの丸みで切り抜く） */
export const CORNER_RATIO = FACE_CORNER / FACE_W;

const W = CELL_W;
const H = CELL_H;
const PAPER = '#fbfaf5';

type Ctx = CanvasRenderingContext2D;

/** アトラスの番号 cell（表は Card、裏は BACK_CELL）の、左上のピクセル位置 */
export function cellOrigin(cell: number): { x: number; y: number } {
  return { x: (cell % ATLAS_COLS) * CELL_W, y: Math.floor(cell / ATLAS_COLS) * CELL_H };
}

/** カードの絵のアトラスをテクスチャにする。表の場所は、表を描くまで紙の色のまま */
export const createCardAtlas = (): THREE.Texture => paintedTexture(ATLAS_W, ATLAS_H, (ctx) => paintCardAtlas(ctx, null));

/** 読み込んだ表を、createCardAtlas で作ったアトラスに描き足す */
export function paintCardFaces(atlas: THREE.Texture, faces: CardFaces): void {
  repaintTexture(atlas, (ctx) => paintCardAtlas(ctx, faces));
}

/** アトラス全体を描く。faces が null なら、表の場所は紙の色で塗るだけ */
export function paintCardAtlas(ctx: Ctx, faces: CardFaces | null): void {
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  for (let c = 0; c < DECK_SIZE; c++) {
    const o = cellOrigin(c);
    // 表の SVG の角の外は透明なので、紙の色を敷いてから描く（角はシェーダーが切り抜く）
    ctx.fillStyle = PAPER;
    ctx.fillRect(o.x, o.y, W, H);
    if (faces) ctx.drawImage(faces[c], 0, 0, FACE_W, FACE_H, o.x, o.y, W, H);
  }
  const o = cellOrigin(BACK_CELL);
  ctx.save();
  ctx.translate(o.x, o.y);
  paintBack(ctx);
  ctx.restore();
}

// ---- スートの形（裏の飾り） ----

/** スートの形のパス。中心 (0, 0)、高さ 1（y は下向き） */
function suitPath(ctx: Ctx, suit: Suit): void {
  ctx.beginPath();
  switch (suit) {
    case Suit.Heart:
      ctx.moveTo(0, 0.45);
      ctx.bezierCurveTo(-0.1, 0.33, -0.5, 0.06, -0.5, -0.17);
      ctx.bezierCurveTo(-0.5, -0.36, -0.36, -0.47, -0.24, -0.47);
      ctx.bezierCurveTo(-0.11, -0.47, -0.03, -0.38, 0, -0.27);
      ctx.bezierCurveTo(0.03, -0.38, 0.11, -0.47, 0.24, -0.47);
      ctx.bezierCurveTo(0.36, -0.47, 0.5, -0.36, 0.5, -0.17);
      ctx.bezierCurveTo(0.5, 0.06, 0.1, 0.33, 0, 0.45);
      break;
    case Suit.Diamond:
      ctx.moveTo(0, -0.5);
      ctx.quadraticCurveTo(0.17, -0.22, 0.37, 0);
      ctx.quadraticCurveTo(0.17, 0.22, 0, 0.5);
      ctx.quadraticCurveTo(-0.17, 0.22, -0.37, 0);
      ctx.quadraticCurveTo(-0.17, -0.22, 0, -0.5);
      break;
    case Suit.Spade:
      ctx.moveTo(0, -0.5);
      ctx.bezierCurveTo(-0.1, -0.36, -0.5, -0.12, -0.5, 0.1);
      ctx.bezierCurveTo(-0.5, 0.28, -0.37, 0.37, -0.24, 0.37);
      ctx.bezierCurveTo(-0.14, 0.37, -0.06, 0.32, -0.03, 0.25);
      ctx.bezierCurveTo(-0.04, 0.36, -0.1, 0.44, -0.2, 0.5);
      ctx.lineTo(0.2, 0.5);
      ctx.bezierCurveTo(0.1, 0.44, 0.04, 0.36, 0.03, 0.25);
      ctx.bezierCurveTo(0.06, 0.32, 0.14, 0.37, 0.24, 0.37);
      ctx.bezierCurveTo(0.37, 0.37, 0.5, 0.28, 0.5, 0.1);
      ctx.bezierCurveTo(0.5, -0.12, 0.1, -0.36, 0, -0.5);
      break;
    case Suit.Club:
      ctx.arc(0, -0.25, 0.215, 0, Math.PI * 2);
      ctx.moveTo(-0.245 + 0.215, 0.07);
      ctx.arc(-0.245, 0.07, 0.215, 0, Math.PI * 2);
      ctx.moveTo(0.245 + 0.215, 0.07);
      ctx.arc(0.245, 0.07, 0.215, 0, Math.PI * 2);
      ctx.moveTo(0.12, 0.02);
      ctx.arc(0, 0.02, 0.12, 0, Math.PI * 2);
      // 軸は円と同じ向き（時計回り）に回して、重なったところが抜けないようにする
      ctx.moveTo(0.035, 0.1);
      ctx.bezierCurveTo(0.04, 0.3, 0.1, 0.42, 0.2, 0.5);
      ctx.lineTo(-0.2, 0.5);
      ctx.bezierCurveTo(-0.1, 0.42, -0.04, 0.3, -0.035, 0.1);
      break;
  }
  ctx.closePath();
}

/** (x, y) を中心に、高さ size のスートを塗る。flip なら逆さ */
function pip(ctx: Ctx, suit: Suit, x: number, y: number, size: number, flip: boolean, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.rotate(Math.PI);
  ctx.scale(size, size);
  suitPath(ctx, suit);
  ctx.fillStyle = color;
  ctx.fill('nonzero');
  ctx.restore();
}

// ---- 裏 ----

/** 裏: 白い縁の中に、深い赤の地と細かい斜めの格子、二重の内枠、真ん中の楕円の飾り */
function paintBack(ctx: Ctx): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  const m = 12;
  const fw = W - m * 2;
  const fh = H - m * 2;
  ctx.save();
  ctx.translate(m, m);
  ctx.fillStyle = CARD_INK.back;
  ctx.fillRect(0, 0, fw, fh);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, fw, fh);
  ctx.clip();
  ctx.strokeStyle = CARD_INK.backLine;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const step = 11;
  for (let d = -fh; d < fw + fh; d += step) {
    ctx.moveTo(d, 0);
    ctx.lineTo(d + fh, fh);
    ctx.moveTo(d, fh);
    ctx.lineTo(d + fh, 0);
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 2.2;
  ctx.strokeRect(6, 6, fw - 12, fh - 12);
  ctx.lineWidth = 1;
  ctx.strokeRect(10, 10, fw - 20, fh - 20);
  // 真ん中の楕円の飾り: 地の色で塗り、白の二重線で縁取り、4 つのスートを十字に置く
  const cx = fw / 2;
  const cy = fh / 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 46, 62, 0, 0, Math.PI * 2);
  ctx.fillStyle = CARD_INK.back;
  ctx.fill();
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy, 40, 56, 0, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.stroke();
  pip(ctx, Suit.Spade, cx, cy - 30, 20, false, PAPER);
  pip(ctx, Suit.Heart, cx + 22, cy, 20, false, PAPER);
  pip(ctx, Suit.Club, cx, cy + 30, 20, true, PAPER);
  pip(ctx, Suit.Diamond, cx - 22, cy, 20, false, PAPER);
  ctx.restore();
}
