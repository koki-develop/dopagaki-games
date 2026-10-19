import { CHIP_VALUES } from '../denominations.ts';
import { CHIP_COLORS } from './palette.ts';

/*
 * カジノのチップの上の面。焼き物のチップのように、地の色の縁に 6 つの差し色の模様（エッジスポット）、
 * 内側に細い点線の輪、真ん中に白い円の札（インレイ）と額を描く。額面ごとに 1 枚ずつ横に並べた画像（アトラス）にする。
 * three.js には触れず、描く手順だけを持つ（テクスチャにするのは chips.ts、ボタンの絵は画面が描く）。
 */

/** チップ 1 枚の画像の一辺（ピクセル）と、アトラスの大きさ（額面の数だけ横に並べる） */
export const CHIP_CELL = 160;
export const CHIP_ATLAS_W = CHIP_CELL * CHIP_VALUES.length;
export const CHIP_ATLAS_H = CHIP_CELL;
/** チップの縁の模様の数と、1 つの模様の角度の幅（ラジアン）。側面の模様（シェーダー）も同じ並びで描く */
export const CHIP_SPOTS = 6;
export const CHIP_SPOT_WIDTH = 0.36;

type Ctx = CanvasRenderingContext2D;

/** 額の書き方（区切りを入れない数字。チップの札に収まる 4 桁まで） */
export const chipLabel = (value: number): string => String(value);

/** アトラス全体を描く */
export function paintChipAtlas(ctx: Ctx): void {
  ctx.clearRect(0, 0, CHIP_ATLAS_W, CHIP_ATLAS_H);
  for (let d = 0; d < CHIP_VALUES.length; d++) paintChipFace(ctx, d, d * CHIP_CELL + CHIP_CELL / 2, CHIP_CELL / 2, CHIP_CELL / 2 - 1);
}

/** 額面 d（CHIP_VALUES の添字）のチップの上の面を、中心 (cx, cy)・半径 r で描く */
export function paintChipFace(ctx: Ctx, d: number, cx: number, cy: number, r: number): void {
  const c = CHIP_COLORS[d];
  ctx.save();
  ctx.translate(cx, cy);
  // 地
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = c.base;
  ctx.fill();
  // 縁の模様: 差し色の台形に、地の色の細い線を 2 本ずつ入れる
  for (let k = 0; k < CHIP_SPOTS; k++) {
    const a = (k / CHIP_SPOTS) * Math.PI * 2;
    const h = CHIP_SPOT_WIDTH / 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, a - h, a + h);
    ctx.arc(0, 0, r * 0.76, a + h * 0.9, a - h * 0.9, true);
    ctx.closePath();
    ctx.fillStyle = c.spot;
    ctx.fill();
    ctx.strokeStyle = c.base;
    ctx.lineWidth = r * 0.025;
    ctx.beginPath();
    for (const off of [-h * 0.35, h * 0.35]) {
      ctx.moveTo(Math.cos(a + off) * r * 0.79, Math.sin(a + off) * r * 0.79);
      ctx.lineTo(Math.cos(a + off) * r * 0.98, Math.sin(a + off) * r * 0.98);
    }
    ctx.stroke();
  }
  // 内側の点線の輪
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
  ctx.setLineDash([r * 0.06, r * 0.05]);
  ctx.strokeStyle = c.spot;
  ctx.lineWidth = r * 0.035;
  ctx.stroke();
  ctx.setLineDash([]);
  // 真ん中の札: 白い円と、地の色の細い輪、額
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.58, 0, Math.PI * 2);
  ctx.fillStyle = '#f7f2e6';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
  ctx.strokeStyle = c.base;
  ctx.lineWidth = r * 0.03;
  ctx.stroke();
  const label = chipLabel(CHIP_VALUES[d]);
  ctx.fillStyle = c.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 札（半径 0.52 の輪の内側）に収まる大きさ。桁が多いほど小さくし、書体の幅が広い端末でも輪の内側の幅で横に詰める
  const size = r * (label.length >= 4 ? 0.34 : label.length === 3 ? 0.42 : 0.52);
  ctx.font = `900 ${size}px "Helvetica Neue", Arial, "Noto Sans", sans-serif`;
  ctx.fillText(label, 0, r * 0.03, r * 0.86);
  // 光: 左上を明るく、右下を暗く（地の上だけ）
  const shade = ctx.createLinearGradient(-r, -r, r, r);
  shade.addColorStop(0, 'rgba(255,255,255,0.22)');
  shade.addColorStop(0.5, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = shade;
  ctx.fill();
  ctx.restore();
}
