import { effectiveCapacity } from '../../../engine/ring.ts';
import { BLOCK_H, BLOCK_W, BlockType, FIELD_H } from '../config.ts';
import { blockRgb } from '../view/palette.ts';
import { Fracture, fractureRect, MAX_PIECE_VERTS, MAX_PIECES, pieceMass, rayToRect } from './fracture.ts';
import type { PieceMass } from './fracture.ts';
import type { DebrisSpec } from './particle-shape.ts';

/** now は present の時間軸（シェーダーの u.time）の秒 */
export type DebrisSink = { emit(now: number, spec: DebrisSpec): void };

/** 破片を描くリングバッファの容量 */
export const DEBRIS_CAPACITY = 4096;
/** 破片の寿命の範囲（秒） */
export const DEBRIS_LIFE_MIN = 0.5;
export const DEBRIS_LIFE_MAX = 0.8;
/** 1 つのブロックから出す破片の数の上限 */
export const MAX_DEBRIS_PER_BLOCK = 3;
/** 一度に出せる破片の数（実効容量に対する割合）。残りを寿命の間に均して出す */
const BURST_SHARE = 1 / 8;

const HALF_W = BLOCK_W / 2;
const HALF_H = BLOCK_H / 2;
/** ブロックを割る数。このうち数個だけを破片として出す */
const SPLIT_MIN = 6;
/** 出す破片は、割った形を重心のまわりでこの倍率に縮める。大きな破片は、面積が MAX_PIECE_AREA になるまで縮める */
const PIECE_SCALE = 0.7;
export const MAX_PIECE_AREA = (BLOCK_W * BLOCK_H) / 12;
/** 破断点を、ブロックの中心から当たった点までの、この割合の範囲に置く */
const ORIGIN_NEAR = 0.3;
const ORIGIN_FAR = 0.55;
/** 破断点を、当たった点の向きと直交する方向へ揺らす幅（ブロックの半分の大きさに対する割合） */
const ORIGIN_JITTER = 0.25;
/** 破断点での速さと、破断点から一番遠い点での速さ（u/s） */
const SPEED_NEAR = 2.4;
const SPEED_FAR = 0.8;
/** 当たった側から押し出す速さ（u/s） */
const PUSH = 0.8;
/** 回る速さの範囲（ラジアン / 秒） */
const SPIN_MIN = 1.5;
const SPIN_MAX = 5;

/** 種類ごとに出す破片の数。硬いものや派手なものは 1 つ多い */
const emitCount = (type: number): number => (type === BlockType.Ball ? 2 : MAX_DEBRIS_PER_BLOCK);

/**
 * ブロックを割って、小さな破片をいくつか落とす。
 *
 * 当たった点の近くに破断点を置き、そこから放射状に割る（`fracture.ts`）。そのうちの数個を縮めて、
 * 破断点から外へ、当たった側と反対へこぼれるように出す。
 *
 * 描画のリングバッファは、容量を超えると古い破片から上書きする。寿命の間に出す破片の数を、
 * 実効容量（容量 × 予算）以内に抑え、生きている破片を上書きしないようにする（トークンバケツ）。
 * 出せる数が足りないときは、そのブロックからは出さない。
 *
 * 発生の条件を書き込むオブジェクトと割った結果は、1 つを使い回す。
 */
export class DebrisFx {
  private readonly sink: DebrisSink;
  private readonly rand: () => number;
  private readonly spec: DebrisSpec = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    spin: 0,
    life: 0,
    r: 0,
    g: 0,
    b: 0,
    verts: new Float64Array(MAX_PIECE_VERTS * 2),
  };
  private readonly fracture = new Fracture();
  private readonly mass: PieceMass = { x: 0, y: 0, area: 0 };
  private readonly rgb: [number, number, number] = [0, 0, 0];
  /** 出す破片を選ぶための、破片の番号の並び */
  private readonly order = new Uint8Array(MAX_PIECES);
  /** まだ出せる破片の数と、最後に数え直した時刻。最初に割るときに満たす */
  private tokens = 0;
  private lastNow = Number.NaN;

  constructor(sink: DebrisSink, rand: () => number = Math.random) {
    this.sink = sink;
    this.rand = rand;
  }

  /**
   * 中心 (x, y) のブロック（種類 type）を、点 (fromX, fromY) から力を受けて割る。
   * 点がブロックの外なら、中心からその点へ向かう線と輪郭の交点に当たったとみなす。点が中心と同じなら、向きは乱数で決める。
   * 破片を出したら true。budget はパーティクルの品質の倍率（0〜1）
   */
  shatter(now: number, x: number, y: number, type: number, fromX: number, fromY: number, budget: number): boolean {
    this.refill(now, budget);
    if (this.tokens < MAX_DEBRIS_PER_BLOCK) return false;
    const rand = this.rand;

    // 当たった向き（中心から当たった点へ）
    let dx = fromX - x;
    let dy = fromY - y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      dx /= len;
      dy /= len;
    } else {
      const a = rand() * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
    }
    // 破断点: 中心から輪郭までの途中に置き、直交する向きへ少し揺らす
    const reach = rayToRect(HALF_W, HALF_H, 0, 0, dx, dy) * (ORIGIN_NEAR + (ORIGIN_FAR - ORIGIN_NEAR) * rand());
    const side = (rand() * 2 - 1) * ORIGIN_JITTER;
    const ox = clampAbs(dx * reach - dy * side * HALF_W, HALF_W * 0.8);
    const oy = clampAbs(dy * reach + dx * side * HALF_H, HALF_H * 0.8);
    const f = fractureRect(HALF_W, HALF_H, ox, oy, SPLIT_MIN + Math.floor(rand() * 2), rand, this.fracture);

    // 出す破片を選ぶ（先頭から count 個を並べ替える）
    const order = this.order;
    for (let k = 0; k < f.count; k++) order[k] = k;
    const count = emitCount(type);
    for (let k = 0; k < count; k++) {
      const pick = k + Math.floor(rand() * (f.count - k));
      const t = order[k];
      order[k] = order[pick];
      order[pick] = t;
    }
    this.tokens -= count;

    const reachMax = Math.hypot(ox, oy) + Math.hypot(HALF_W, HALF_H);
    const s = this.spec;
    const m = this.mass;
    const rgb = this.rgb;
    for (let i = 0; i < count; i++) {
      const k = order[i];
      pieceMass(f, k, m);
      s.x = x + m.x;
      s.y = y + m.y;

      // 頂点を重心基準に直して縮める。三角形は 4 つ目に 3 つ目を写す
      const scale = Math.min(PIECE_SCALE, Math.sqrt(MAX_PIECE_AREA / m.area));
      const n = f.vertCount[k];
      const base = k * MAX_PIECE_VERTS * 2;
      for (let j = 0; j < MAX_PIECE_VERTS; j++) {
        const src = base + Math.min(j, n - 1) * 2;
        s.verts[j * 2] = (f.verts[src] - m.x) * scale;
        s.verts[j * 2 + 1] = (f.verts[src + 1] - m.y) * scale;
      }

      // 破断点から外へ。近いものほど速い。全体を当たった側と反対へ押し出す
      let rx = m.x - ox;
      let ry = m.y - oy;
      const dist = Math.hypot(rx, ry);
      rx /= dist;
      ry /= dist;
      const speed = (SPEED_NEAR + (SPEED_FAR - SPEED_NEAR) * Math.min(1, dist / reachMax)) * (0.8 + 0.4 * rand());
      s.vx = rx * speed - dx * PUSH;
      s.vy = ry * speed - dy * PUSH;

      s.spin = (rand() < 0.5 ? -1 : 1) * (SPIN_MIN + (SPIN_MAX - SPIN_MIN) * rand());
      s.life = DEBRIS_LIFE_MIN + (DEBRIS_LIFE_MAX - DEBRIS_LIFE_MIN) * rand();

      blockRgb(type, y / FIELD_H, m.x, now, rgb);
      s.r = rgb[0];
      s.g = rgb[1];
      s.b = rgb[2];
      this.sink.emit(now, s);
    }
    return true;
  }

  /** 前に数え直してからの時間の分だけ、出せる数を足す */
  private refill(now: number, budget: number): void {
    const capacity = effectiveCapacity(DEBRIS_CAPACITY, budget);
    const burst = Math.floor(capacity * BURST_SHARE);
    const rate = (capacity - burst) / DEBRIS_LIFE_MAX;
    this.tokens = Number.isNaN(this.lastNow) ? burst : Math.min(burst, this.tokens + rate * Math.max(0, now - this.lastNow));
    this.lastNow = now;
  }
}

const clampAbs = (v: number, limit: number): number => Math.min(limit, Math.max(-limit, v));
