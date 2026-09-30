import { BALL_CAP } from '../config.ts';

/**
 * ボールの読み取り用の面。添字 0〜count-1 が生きているボール。
 * 型付き配列は中身を書き換えられてしまうが、書き換えてよいのは sim だけ。
 */
export interface ReadonlyBallStore {
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** 直前のステップの位置。補間描画に使う */
  readonly px: Float64Array;
  readonly py: Float64Array;
  /** 向き（単位ベクトル） */
  readonly dx: Float64Array;
  readonly dy: Float64Array;
  readonly count: number;
}

/**
 * ボールの状態を型付き配列に並べて持つ。
 * 速度は単位ベクトル（dx, dy）で持ち、速さは全ボール共通の値を掛けて使う。
 * 補間描画のために、直前のステップの位置（px, py）も持つ。
 */
export class BallStore implements ReadonlyBallStore {
  readonly x = new Float64Array(BALL_CAP);
  readonly y = new Float64Array(BALL_CAP);
  readonly px = new Float64Array(BALL_CAP);
  readonly py = new Float64Array(BALL_CAP);
  readonly dx = new Float64Array(BALL_CAP);
  readonly dy = new Float64Array(BALL_CAP);
  readonly dead = new Uint8Array(BALL_CAP);
  count = 0;

  /** 追加できなければ -1 を返す */
  add(x: number, y: number, dx: number, dy: number): number {
    if (this.count >= BALL_CAP) return -1;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.px[i] = x;
    this.py[i] = y;
    this.dx[i] = dx;
    this.dy[i] = dy;
    this.dead[i] = 0;
    return i;
  }

  /** dead の付いたボールを取り除き、残りを順序を保ったまま詰める */
  compact(): void {
    let w = 0;
    const n = this.count;
    for (let r = 0; r < n; r++) {
      if (this.dead[r]) continue;
      if (w !== r) {
        this.x[w] = this.x[r];
        this.y[w] = this.y[r];
        this.px[w] = this.px[r];
        this.py[w] = this.py[r];
        this.dx[w] = this.dx[r];
        this.dy[w] = this.dy[r];
      }
      this.dead[w] = 0;
      w++;
    }
    this.count = w;
  }

  /** 動かさないステップで呼ぶ。直前の位置を今の位置にそろえ、補間描画でボールが動いて見えないようにする */
  hold(): void {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
    }
  }
}
