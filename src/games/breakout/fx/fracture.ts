/**
 * 矩形を、中の 1 点（破断点）から放射状に割る。ガラスが割れたときのように、破断点の近くほど細かい破片になる。
 *
 * 破断点から輪郭へ引いた線（切れ目）で割るので、どの破片も「破断点・輪郭上の 2 点・その間の角（0 か 1 個）」の
 * 三角形か四角形になる。角と角の間には必ず切れ目を入れるので、1 つの破片に角は 2 つ入らない。
 * 破断点から見た破片の開き（角度）は MAX_SPAN より狭くするので、どの破片も凸になる。
 */

/** 1 つの矩形から作る破片の数の上限 */
export const MAX_PIECES = 8;
/** 必ず入れる切れ目の数（角と角の間に 1 本ずつ）。破片はこれより少なくならない */
export const MIN_PIECES = 4;
/** 破片 1 つの頂点の数の上限（三角形か四角形） */
export const MAX_PIECE_VERTS = 4;
/** 破断点から見た、破片 1 つの開きの上限（ラジアン）。π より狭ければ凸になる */
const MAX_SPAN = Math.PI * 0.8;
const TAU = Math.PI * 2;
/** 角の向き（右上・左上・左下・右下）。Fracture.corners と同じ並び */
const CORNER_SX = [1, -1, -1, 1] as const;
const CORNER_SY = [1, 1, -1, -1] as const;

/** 割った結果。1 つを使い回し、割るたびに中身を書き換える */
export class Fracture {
  /** 破片の数 */
  count = 0;
  /**
   * 破片 k の j 番目の頂点は (verts[(k * MAX_PIECE_VERTS + j) * 2], 同 + 1)。矩形の中心が原点で、反時計回り。
   * 頂点の数は vertCount[k]（3 か 4）
   */
  readonly verts = new Float64Array(MAX_PIECES * MAX_PIECE_VERTS * 2);
  readonly vertCount = new Uint8Array(MAX_PIECES);
  /** 切れ目の向き（破断点から見た角度）。小さい順に並べる作業領域 */
  readonly cuts = new Float64Array(MAX_PIECES);
  /** 角の向き（右上・左上・左下・右下の順に、反時計回りに増えるよう巻き戻したもの） */
  readonly corners = new Float64Array(4);
}

/** 原点から (dx, dy) の向きへ進んで、半分の大きさ (hw, hh) の矩形の輪郭に着くまでの倍率。(ox, oy) は出発点で、矩形の内側 */
export function rayToRect(hw: number, hh: number, ox: number, oy: number, dx: number, dy: number): number {
  const tx = dx > 0 ? (hw - ox) / dx : dx < 0 ? (-hw - ox) / dx : Number.POSITIVE_INFINITY;
  const ty = dy > 0 ? (hh - oy) / dy : dy < 0 ? (-hh - oy) / dy : Number.POSITIVE_INFINITY;
  return Math.min(tx, ty);
}

/**
 * 半分の大きさ (hw, hh) の矩形を、破断点 (ox, oy)（矩形の中心基準、内側）から割る。
 * 破片はおよそ pieces 個（MIN_PIECES〜MAX_PIECES に収める）。開きが広すぎる破片が残るときは、それより多くなる。
 * rand は 0 以上 1 未満の乱数。
 */
export function fractureRect(
  hw: number,
  hh: number,
  ox: number,
  oy: number,
  pieces: number,
  rand: () => number,
  out: Fracture,
): Fracture {
  const target = Math.min(MAX_PIECES, Math.max(MIN_PIECES, Math.round(pieces)));
  const corners = out.corners;
  for (let k = 0; k < 4; k++) {
    corners[k] = Math.atan2(CORNER_SY[k] * hh - oy, CORNER_SX[k] * hw - ox);
    if (k > 0) while (corners[k] <= corners[k - 1]) corners[k] += TAU;
  }
  const start = corners[0];

  // 角と角の間に 1 本ずつ。区間の真ん中寄りに置き、角のそばに細い破片を作らない
  const cuts = out.cuts;
  for (let k = 0; k < 4; k++) {
    const a = corners[k];
    const b = k < 3 ? corners[k + 1] : start + TAU;
    cuts[k] = a + (b - a) * (0.35 + 0.3 * rand());
  }
  let n = 4;

  // 一番開いた破片を、真ん中寄りで 2 つに割っていく
  while (n < MAX_PIECES) {
    let widest = 0;
    let widestSpan = -1;
    for (let i = 0; i < n; i++) {
      const span = (i + 1 < n ? cuts[i + 1] : cuts[0] + TAU) - cuts[i];
      if (span > widestSpan) {
        widestSpan = span;
        widest = i;
      }
    }
    if (n >= target && widestSpan <= MAX_SPAN) break;
    let angle = cuts[widest] + widestSpan * (0.4 + 0.2 * rand());
    if (angle >= start + TAU) {
      // 最後と最初の切れ目の間を割り、1 周して先頭に入る
      angle -= TAU;
      cuts.copyWithin(1, 0, n);
      cuts[0] = angle;
    } else {
      cuts.copyWithin(widest + 2, widest + 1, n);
      cuts[widest + 1] = angle;
    }
    n++;
  }

  out.count = n;
  const verts = out.verts;
  for (let i = 0; i < n; i++) {
    const t0 = cuts[i];
    const t1 = i + 1 < n ? cuts[i + 1] : cuts[0] + TAU;
    let o = i * MAX_PIECE_VERTS * 2;
    verts[o++] = ox;
    verts[o++] = oy;
    const c0 = Math.cos(t0);
    const s0 = Math.sin(t0);
    const r0 = rayToRect(hw, hh, ox, oy, c0, s0);
    verts[o++] = ox + c0 * r0;
    verts[o++] = oy + s0 * r0;
    // 切れ目の間にある角。t1 は 1 周先まで届くので、1 周先の角も見る
    let count = 3;
    for (let k = 0; k < 8; k++) {
      const corner = k & 3;
      const c = corners[corner] + (k < 4 ? 0 : TAU);
      if (c <= t0 || c >= t1) continue;
      verts[o++] = CORNER_SX[corner] * hw;
      verts[o++] = CORNER_SY[corner] * hh;
      count++;
      break;
    }
    const c1 = Math.cos(t1);
    const s1 = Math.sin(t1);
    const r1 = rayToRect(hw, hh, ox, oy, c1, s1);
    verts[o++] = ox + c1 * r1;
    verts[o++] = oy + s1 * r1;
    out.vertCount[i] = count;
  }
  return out;
}

/** 重心と面積を書き込む先 */
export type PieceMass = { x: number; y: number; area: number };

/** 破片 k の重心と面積（頂点が反時計回りなので、面積は正） */
export function pieceMass(f: Fracture, k: number, out: PieceMass): PieceMass {
  const v = f.verts;
  const n = f.vertCount[k];
  const base = k * MAX_PIECE_VERTS * 2;
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let j = 0; j < n; j++) {
    const x0 = v[base + j * 2];
    const y0 = v[base + j * 2 + 1];
    const jn = j + 1 < n ? j + 1 : 0;
    const x1 = v[base + jn * 2];
    const y1 = v[base + jn * 2 + 1];
    const cross = x0 * y1 - x1 * y0;
    a2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  out.area = a2 / 2;
  out.x = cx / (3 * a2);
  out.y = cy / (3 * a2);
  return out;
}
