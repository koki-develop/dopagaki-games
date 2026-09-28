import { clamp } from '../../../shared/math.ts';
import {
  BALL_CAP,
  BALL_RADIUS,
  BLOCK_H,
  BLOCK_INSET_X,
  BLOCK_INSET_Y,
  BLOCK_W,
  BlockType,
  CELL_H,
  COLS,
  FIELD_H,
  FIELD_W,
  PADDLE_Y,
} from '../config.ts';
import type { SimConfig } from '../config.ts';
import type { BallStore } from './balls.ts';
import { cellLeft, colAtX } from './blocks.ts';
import type { BlockField } from './blocks.ts';
import { EventKind } from './events.ts';
import type { EventQueue } from './events.ts';

const R = BALL_RADIUS;
const R2 = R * R;
const DEG = Math.PI / 180;
/** 1 ステップで 1 個のボールが当たったブロックを覚えておく数。1 ステップで触れられるのは多くても 6 個 */
const HITS_PER_BALL = 8;
/** 1 回の判定で集める接触の数の上限。ボールが同時に触れられるのは多くても 4 個 */
const MAX_CONTACTS = 8;

/**
 * ブロックに当たったときの処理（得点、破壊、分裂）。
 * dirX / dirY は当てたボールが跳ね返った向き、hitX / hitY はブロックの輪郭上の当たった点。
 */
export interface BlockHitHandler {
  onBlockHit(index: number, row: number, col: number, dirX: number, dirY: number, hitX: number, hitY: number): void;
}

/**
 * 1 ステップの間に、ボールごとに当たったブロックを覚えておく。
 * 同じボールが同じブロックに 1 ステップで 2 回以上当たったことにはしない（凹んだ角や、降りてくるブロックに押されたとき）。
 */
class HitLog {
  private readonly blocks = new Int32Array(BALL_CAP * HITS_PER_BALL);
  private readonly counts = new Uint8Array(BALL_CAP);

  reset(): void {
    this.counts.fill(0);
  }

  /** このステップで ball が index に当たるのが初めてなら記録して true */
  first(ball: number, index: number): boolean {
    const n = this.counts[ball];
    const base = ball * HITS_PER_BALL;
    for (let k = 0; k < n; k++) if (this.blocks[base + k] === index) return false;
    if (n < HITS_PER_BALL) {
      this.blocks[base + n] = index;
      this.counts[ball] = n + 1;
    }
    return true;
  }
}

/**
 * ボールと壁・ブロック・パドルの衝突。ボールは位置と向きをその場で書き換える。
 * ブロックに当たったら、同じステップで初めてのときだけ handler に知らせる。
 */
export class Collider {
  private readonly balls: BallStore;
  private readonly field: BlockField;
  private readonly events: EventQueue;
  private readonly handler: BlockHitHandler;
  readonly hits = new HitLog();

  /** 水平からこの角度（sin）より寝た向きは起こす */
  private readonly minSin: number;
  private readonly minCos: number;
  private readonly paddleHalf: number;
  private readonly paddleTop: number;
  private readonly paddleBottom: number;
  private readonly maxBounceDeg: number;
  private paddleX = FIELD_W / 2;
  private paddlePrevX = FIELD_W / 2;

  private readonly contactIndex = new Int32Array(MAX_CONTACTS);
  private readonly contactRow = new Int32Array(MAX_CONTACTS);
  private readonly contactCol = new Int32Array(MAX_CONTACTS);
  private readonly contactNx = new Float64Array(MAX_CONTACTS);
  private readonly contactNy = new Float64Array(MAX_CONTACTS);
  private readonly contactX = new Float64Array(MAX_CONTACTS);
  private readonly contactY = new Float64Array(MAX_CONTACTS);
  private readonly contactApproach = new Uint8Array(MAX_CONTACTS);

  constructor(balls: BallStore, field: BlockField, events: EventQueue, cfg: SimConfig, handler: BlockHitHandler) {
    this.balls = balls;
    this.field = field;
    this.events = events;
    this.handler = handler;
    this.minSin = Math.sin(cfg.ball.minDegFromHorizontal * DEG);
    this.minCos = Math.sqrt(1 - this.minSin * this.minSin);
    this.paddleHalf = cfg.paddle.width / 2;
    this.paddleTop = PADDLE_Y + cfg.paddle.height / 2;
    this.paddleBottom = PADDLE_Y - cfg.paddle.height / 2;
    this.maxBounceDeg = cfg.paddle.maxBounceDeg;
  }

  /** このステップのパドルの位置。直前のステップからこのステップまでに通過した範囲で当たりを取る */
  setPaddle(prevX: number, x: number): void {
    this.paddlePrevX = prevX;
    this.paddleX = x;
  }

  /** 水平から minDeg 以内の向きを、minDeg まで起こす */
  clampAngle(i: number): void {
    const b = this.balls;
    const dy = b.dy[i];
    if (Math.abs(dy) >= this.minSin) return;
    b.dy[i] = dy < 0 ? -this.minSin : this.minSin;
    b.dx[i] = b.dx[i] < 0 ? -this.minCos : this.minCos;
  }

  /** 左右の壁と天井。floor なら、奈落の底（y = 0）でも跳ね返す */
  walls(i: number, floor: boolean): void {
    const b = this.balls;
    let bounced = false;
    if (b.x[i] < R) {
      b.x[i] = 2 * R - b.x[i];
      b.dx[i] = Math.abs(b.dx[i]);
      this.events.push(EventKind.WallHit, 0, b.y[i], -1, 0);
      bounced = true;
    } else if (b.x[i] > FIELD_W - R) {
      b.x[i] = 2 * (FIELD_W - R) - b.x[i];
      b.dx[i] = -Math.abs(b.dx[i]);
      this.events.push(EventKind.WallHit, FIELD_W, b.y[i], 1, 0);
      bounced = true;
    }
    if (b.y[i] > FIELD_H - R) {
      b.y[i] = 2 * (FIELD_H - R) - b.y[i];
      b.dy[i] = -Math.abs(b.dy[i]);
      this.events.push(EventKind.WallHit, b.x[i], FIELD_H, 0, 1);
      bounced = true;
    } else if (floor && b.y[i] < R) {
      b.y[i] = 2 * R - b.y[i];
      b.dy[i] = Math.abs(b.dy[i]);
      bounced = true;
    }
    if (bounced) this.clampAngle(i);
  }

  /**
   * ブロックとの衝突。触れているブロックすべてから押し出し、めり込みの深さで重み付けした法線で反射する。
   * 凹んだ角では、合成した法線で反射してもまだ一方の面へ向かっていることがあるので、
   * 向かっている面ごとにもう一度反射して、どの面からも離れる向きにする。
   */
  blocks(i: number): void {
    const b = this.balls;
    const f = this.field;
    if (f.rowCount === 0) return;
    const x = b.x[i];
    const y = b.y[i];
    const c0 = Math.max(0, colAtX(x - R));
    const c1 = Math.min(COLS - 1, colAtX(x + R));
    const r0 = Math.max(0, Math.floor((y - R - f.lowestRowY) / CELL_H));
    const r1 = Math.min(f.rowCount - 1, Math.floor((y + R - f.lowestRowY) / CELL_H));
    if (r0 > r1 || c0 > c1) return;

    let contacts = 0;
    let nxSum = 0;
    let nySum = 0;
    let px = x;
    let py = y;
    for (let row = r0; row <= r1; row++) {
      const base = f.slotOf(row) * COLS;
      const by0 = f.rowBottomY(row) + BLOCK_INSET_Y;
      const by1 = by0 + BLOCK_H;
      for (let col = c0; col <= c1; col++) {
        const idx = base + col;
        if (f.type[idx] === BlockType.Empty) continue;
        const bx0 = cellLeft(col) + BLOCK_INSET_X;
        const bx1 = bx0 + BLOCK_W;
        const cx = px < bx0 ? bx0 : px > bx1 ? bx1 : px;
        const cy = py < by0 ? by0 : py > by1 ? by1 : py;
        const ddx = px - cx;
        const ddy = py - cy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 >= R2) continue;
        let nx: number;
        let ny: number;
        let pen: number;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          nx = ddx / d;
          ny = ddy / d;
          pen = R - d;
        } else {
          // 中心がブロックの内側にある。最も近い辺から押し出す
          const left = px - bx0;
          const right = bx1 - px;
          const bottom = py - by0;
          const top = by1 - py;
          const m = Math.min(left, right, bottom, top);
          if (m === left) {
            nx = -1;
            ny = 0;
          } else if (m === right) {
            nx = 1;
            ny = 0;
          } else if (m === bottom) {
            nx = 0;
            ny = -1;
          } else {
            nx = 0;
            ny = 1;
          }
          pen = m + R;
        }
        px += nx * pen;
        py += ny * pen;
        nxSum += nx * pen;
        nySum += ny * pen;
        if (contacts < MAX_CONTACTS) {
          this.contactIndex[contacts] = idx;
          this.contactRow[contacts] = row;
          this.contactCol[contacts] = col;
          this.contactNx[contacts] = nx;
          this.contactNy[contacts] = ny;
          // 押し出した後のボールの中心から、法線の逆へ半径ぶん戻った点が、ブロックの輪郭上の当たった点
          this.contactX[contacts] = px - nx * R;
          this.contactY[contacts] = py - ny * R;
          this.contactApproach[contacts] = b.dx[i] * nx + b.dy[i] * ny < 0 ? 1 : 0;
          contacts++;
        }
      }
    }
    if (contacts === 0) return;

    b.x[i] = px;
    b.y[i] = py;
    let reflected = false;
    const nl = Math.hypot(nxSum, nySum);
    if (nl > 1e-12) {
      const nx = nxSum / nl;
      const ny = nySum / nl;
      const vn = b.dx[i] * nx + b.dy[i] * ny;
      if (vn < 0) {
        b.dx[i] -= 2 * vn * nx;
        b.dy[i] -= 2 * vn * ny;
        reflected = true;
      }
    }
    if (contacts > 1) {
      for (let k = 0; k < contacts; k++) {
        const nx = this.contactNx[k];
        const ny = this.contactNy[k];
        const vn = b.dx[i] * nx + b.dy[i] * ny;
        if (vn < 0) {
          b.dx[i] -= 2 * vn * nx;
          b.dy[i] -= 2 * vn * ny;
          reflected = true;
        }
      }
    }
    if (reflected) this.clampAngle(i);
    for (let k = 0; k < contacts; k++) {
      if (!this.contactApproach[k]) continue;
      const idx = this.contactIndex[k];
      if (!this.hits.first(i, idx)) continue;
      this.handler.onBlockHit(idx, this.contactRow[k], this.contactCol[k], b.dx[i], b.dy[i], this.contactX[k], this.contactY[k]);
    }
  }

  /** 中心 (x, y) のボールが、生きているブロックの矩形に触れるか */
  overlapsBlock(x: number, y: number): boolean {
    const f = this.field;
    const c0 = Math.max(0, colAtX(x - R));
    const c1 = Math.min(COLS - 1, colAtX(x + R));
    const r0 = Math.max(0, Math.floor((y - R - f.lowestRowY) / CELL_H));
    const r1 = Math.min(f.rowCount - 1, Math.floor((y + R - f.lowestRowY) / CELL_H));
    for (let row = r0; row <= r1; row++) {
      const base = f.slotOf(row) * COLS;
      const by0 = f.rowBottomY(row) + BLOCK_INSET_Y;
      const by1 = by0 + BLOCK_H;
      for (let col = c0; col <= c1; col++) {
        if (f.type[base + col] === BlockType.Empty) continue;
        const bx0 = cellLeft(col) + BLOCK_INSET_X;
        const bx1 = bx0 + BLOCK_W;
        const cx = x < bx0 ? bx0 : x > bx1 ? bx1 : x;
        const cy = y < by0 ? by0 : y > by1 ? by1 : y;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < R2) return true;
      }
    }
    return false;
  }

  /** パドル。当たった位置が端に寄るほど、真上から maxBounceDeg まで傾けて打ち返す */
  paddle(i: number): void {
    const b = this.balls;
    if (b.dy[i] >= 0) return;
    const top = this.paddleTop;
    const y = b.y[i];
    if (y - R > top || y < this.paddleBottom) return;
    const half = this.paddleHalf;
    const xMin = Math.min(this.paddlePrevX, this.paddleX) - half;
    const xMax = Math.max(this.paddlePrevX, this.paddleX) + half;
    const x = b.x[i];
    if (x + R < xMin || x - R > xMax) return;
    const t = clamp((x - this.paddleX) / (half + R), -1, 1);
    const a = t * this.maxBounceDeg * DEG;
    b.dx[i] = Math.sin(a);
    b.dy[i] = Math.cos(a);
    b.y[i] = top + R;
    this.clampAngle(i);
    this.events.push(EventKind.PaddleHit, x, top, t, 0);
  }

  /**
   * ブロック全体が d だけ下がった後、降りてきたブロックの下にいるボールを押し下げる。
   * 押し下げられたボールは下向きに跳ね返るので、出てくるボールもその向きへ飛ばす。
   */
  pushBelowDescending(d: number): void {
    const b = this.balls;
    const f = this.field;
    // 押されたブロックが壊れて出てきたボールも、同じ判定にかける（count はループの中で増える）
    for (let i = 0; i < b.count; i++) {
      const x = b.x[i];
      let y = b.y[i];
      const c0 = Math.max(0, colAtX(x - R));
      const c1 = Math.min(COLS - 1, colAtX(x + R));
      const r0 = Math.max(0, Math.floor((y - R - f.lowestRowY) / CELL_H));
      const r1 = Math.min(f.rowCount - 1, Math.floor((y + R - f.lowestRowY) / CELL_H));
      let pushed = false;
      for (let row = r0; row <= r1; row++) {
        const base = f.slotOf(row) * COLS;
        const by0 = f.rowBottomY(row) + BLOCK_INSET_Y;
        // 動く前の時点でボールの中心がブロックの下端より上にあったものは、横や上からの接触なので通常の衝突に任せる
        if (y > by0 + d) continue;
        for (let col = c0; col <= c1; col++) {
          const idx = base + col;
          if (f.type[idx] === BlockType.Empty) continue;
          const bx0 = cellLeft(col) + BLOCK_INSET_X;
          const bx1 = bx0 + BLOCK_W;
          const hx = x < bx0 ? bx0 - x : x > bx1 ? x - bx1 : 0;
          if (hx >= R) continue;
          const clearY = by0 - Math.sqrt(R2 - hx * hx);
          if (y <= clearY) continue;
          y = clearY;
          pushed = true;
          if (this.hits.first(i, idx)) this.handler.onBlockHit(idx, row, col, b.dx[i], -Math.abs(b.dy[i]), x < bx0 ? bx0 : x > bx1 ? bx1 : x, by0);
        }
      }
      if (!pushed) continue;
      b.y[i] = y;
      if (b.dy[i] > 0) {
        b.dy[i] = -b.dy[i];
        this.clampAngle(i);
      }
    }
  }
}
