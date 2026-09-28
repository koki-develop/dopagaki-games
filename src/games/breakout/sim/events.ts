/**
 * sim から演出へ渡すイベント。
 *
 * 大量に発生するイベント（衝突や破壊）は、固定長の構造体配列に積む。容量を超えた分は捨てるが、
 * 件数は `counts` に必ず数えるので、演出側の集計（破壊ペースや音量）は正確なまま保てる。
 * 取りこぼしてはいけない状態遷移（ゲームオーバーなど）は `signals` のビットで別に持つ。
 * どちらも `clear()` を呼ぶまで、複数のステップにわたって溜まっていく。
 * 積んだイベントには、起きたステップの終わりの sim の時刻（`t`）も残す。
 *
 * 種類ごとの x, y, a, b:
 * - PaddleHit: 当たった位置, a = パドル上の位置（-1〜1）
 * - WallHit: 当たった位置, a = 壁の向き（左 -1 / 右 1 / 天井 0）, b = 天井なら 1
 * - HardHit: ブロックの中心, a = 残り HP, b = 最大 HP
 * - BlockBreak: ブロックの中心, a = ブロックの種類, b = chain 数
 * - Overflow: 上限を超えて出てこられなかったボールの位置
 * - Launch: 打ち出した位置
 * - Drain: 奈落に落ちて失ったボールの、そのステップの終わりの位置（そのまま進んだとしたときの位置）, a, b = 速度（u/s）
 */
export const EventKind = {
  PaddleHit: 0,
  WallHit: 1,
  HardHit: 2,
  BlockBreak: 3,
  Overflow: 4,
  Launch: 5,
  Drain: 6,
} as const;
export type EventKind = (typeof EventKind)[keyof typeof EventKind];
export const EVENT_KIND_COUNT = 7;

export const Signal = {
  /** ボールが 0 個になった */
  BallsZero: 1 << 0,
  /** ステージで残機が減った（まだ続く） */
  LifeLost: 1 << 1,
  GameOver: 1 << 2,
  /** ステージの最後のブロックを壊した。位置は `signalX` / `signalY` */
  StageClear: 1 << 3,
  /** ペナルティで降りてきたブロックが着地した */
  PenaltyLanded: 1 << 4,
  /** エンドレスで、ブロックが 1 段降りて着地した */
  StepLanded: 1 << 5,
} as const;

export class EventQueue {
  readonly capacity: number;
  readonly kind: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** 種類ごとの追加情報（ブロック種別、壁の向きなど） */
  readonly a: Float32Array;
  /** 種類ごとの追加情報（chain 数、残り HP など） */
  readonly b: Float32Array;
  /** 起きたステップの終わりの sim の時刻 */
  readonly t: Float64Array;
  length = 0;
  /** 今のステップの終わりの sim の時刻。sim がステップの初めに書き、push した各イベントの `t` になる */
  time = 0;
  readonly counts = new Uint32Array(EVENT_KIND_COUNT);
  signals = 0;
  /** StageClear の発生位置（最後に壊したブロックの中心） */
  signalX = 0;
  signalY = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.kind = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.a = new Float32Array(capacity);
    this.b = new Float32Array(capacity);
    this.t = new Float64Array(capacity);
  }

  push(kind: EventKind, x: number, y: number, a: number, b: number): void {
    this.counts[kind]++;
    const i = this.length;
    if (i >= this.capacity) return;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.a[i] = a;
    this.b[i] = b;
    this.t[i] = this.time;
    this.length = i + 1;
  }

  signal(bits: number): void {
    this.signals |= bits;
  }

  /** 位置を伴う状態遷移（StageClear）を知らせる */
  signalAt(bits: number, x: number, y: number): void {
    this.signals |= bits;
    this.signalX = x;
    this.signalY = y;
  }

  clear(): void {
    this.length = 0;
    this.counts.fill(0);
    this.signals = 0;
  }
}
