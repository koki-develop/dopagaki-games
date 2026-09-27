import type { QualityGovernor } from './quality.ts';

/** シミュレーションや演出に渡すフレーム間隔の上限（秒）。これを超えた遅れは捨てる */
export const MAX_FRAME_DT = 0.1;

/** 1 フレームぶんの実時間。FrameLoop が 1 つだけ持ち、毎フレーム書き換えて渡す */
export type LoopFrame = {
  /** rAF の生の間隔（秒）。ループを始めた最初のフレームは 0 */
  rawDt: number;
  /** MAX_FRAME_DT で切った間隔（秒）。シミュレーションや演出はこちらを使う */
  dt: number;
};

/**
 * FrameLoop が毎フレーム呼び出す相手（ゲームのセッション）。
 *
 * 1 フレームの流れ:
 * 1. 品質の段階が変わったら `onQualityChange(level)`（そのフレームは必ず描画する）
 * 2. `update(frame)`: 状態を進め、描画用のデータ（uniform やインスタンス）を書き出す。絵が変わったら true を返す
 * 3. `update` が true を返したか、`FrameLoop.invalidate()` が呼ばれていたら描画する
 *
 * 前のフレームと同じ絵になるとき（タイトル、一時停止）は `update` で false を返す。
 * 描画しないフレームも rAF は回り続け、その間隔は品質の判定（リフレッシュ間隔の観測）に使われる。
 * どこかで例外が投げられたら、ループを止めてから `onError` で知らせる。
 */
export interface FrameClient {
  /** 品質の段階が変わった。描画の設定を切り替える */
  onQualityChange(level: number): void;
  /** 1 フレームぶん進める。frame は FrameLoop が使い回すので、呼び出しの外へ持ち出さない。絵が変わったら true */
  update(frame: Readonly<LoopFrame>): boolean;
  /** フレームの処理で例外が投げられた。ループはもう止まっている */
  onError(error: unknown): void;
}

/** rAF を回し、描画する側（RenderHost と PostChain） */
export interface FrameTarget {
  /** 毎フレーム呼ぶ関数を登録する（null で止める）。time は rAF のタイムスタンプ（ms）。渡されないこともある */
  setAnimationLoop(cb: ((time?: number) => void) | null): void;
  /** 1 フレーム描画する */
  render(): void;
}

/**
 * 描画し続けているフレームがこれだけ続いても、リフレッシュ間隔の実測が済んでいなければ、描画したフレームの間隔でも測る。
 * タイトルをすぐに抜けてプレイを始めたとき、プレイ中に品質の判定が働かないままにならないように。
 * 遅めに測れても、描画しないフレームが続いたときに QualityGovernor が速い間隔へ合わせ直す
 */
const CALIBRATE_RENDERED_AFTER = 30;

/**
 * rAF のループ。フレーム間隔を測り、品質の判定へ生の間隔を渡し、呼び出し相手を進めて、必要なときだけ描画する。
 *
 * `start()` した最初のフレームから呼び出し相手を進めて描画する。QualityGovernor のリフレッシュ間隔の実測は、
 * 描画しないフレーム（静止したタイトルなど）の間隔で行い、済むまでは品質の段階を変えない。
 * GPU を失ってレンダラーを作り直したときは、同じ QualityGovernor で新しい FrameLoop を作る。
 */
export class FrameLoop {
  private readonly target: FrameTarget;
  private readonly governor: QualityGovernor;
  private readonly client: FrameClient;
  private readonly now: () => number;
  private readonly frame: LoopFrame = { rawDt: 0, dt: 0 };
  private running = false;
  private lastTime = -1;
  private lastRendered = false;
  /** 続けて描画したフレームの数 */
  private renderedStreak = 0;
  private invalidated = true;

  constructor(opts: { target: FrameTarget; governor: QualityGovernor; client: FrameClient; now?: () => number }) {
    this.target = opts.target;
    this.governor = opts.governor;
    this.client = opts.client;
    this.now = opts.now ?? (() => performance.now());
  }

  /** ループを回し始める。最初のフレームは必ず描画する */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = -1;
    this.lastRendered = false;
    this.renderedStreak = 0;
    this.invalidated = true;
    this.target.setAnimationLoop(this.tick);
  }

  /** ループを止める。start() で再開すると、最初のフレームの間隔は 0 から数え直す */
  stop(): void {
    this.running = false;
    this.lastTime = -1;
    this.target.setAnimationLoop(null);
  }

  /** 次のフレームを必ず描画する（大きさの変更、レイアウトの変更、プレイの切り替えなど） */
  invalidate(): void {
    this.invalidated = true;
  }

  /**
   * 1 フレームぶん進める。rAF から呼ばれる。
   * @param time rAF のタイムスタンプ（ms）。渡されなければ now() を使う
   */
  readonly tick = (time?: number): void => {
    if (!this.running) return;
    try {
      this.step(time ?? this.now());
    } catch (e) {
      this.stop();
      this.client.onError(e);
    }
  };

  private step(t: number): void {
    const rawDt = this.lastTime < 0 ? 0 : Math.max(0, (t - this.lastTime) / 1000);
    this.lastTime = t;
    const f = this.frame;
    f.rawDt = rawDt;
    f.dt = Math.min(rawDt, MAX_FRAME_DT);

    const g = this.governor;
    if (rawDt > 0) {
      if (!g.calibrated) {
        if (!this.lastRendered || this.renderedStreak >= CALIBRATE_RENDERED_AFTER) g.calibrate(rawDt);
      } else if (g.sample(rawDt, this.lastRendered)) {
        this.client.onQualityChange(g.level);
        this.invalidated = true;
      }
    }

    const changed = this.client.update(f);
    if (!this.running) return;
    const render = changed || this.invalidated;
    if (render) {
      this.invalidated = false;
      this.target.render();
    }
    this.lastRendered = render;
    this.renderedStreak = render ? this.renderedStreak + 1 : 0;
  }
}

/**
 * 固定ステップの積み立て。実時間（または世界時間）の dt を受け取り、このフレームで進めるステップ数を返す。
 * 1 フレームで進めるステップ数には上限があり、超えた遅れは捨てる（処理落ちで時間が暴走しないように）。
 */
export class FixedStepper {
  readonly step: number;
  readonly maxSteps: number;
  private acc = 0;

  constructor(step: number, maxSteps: number) {
    this.step = step;
    this.maxSteps = maxSteps;
  }

  /** dt 秒ぶん積み立て、このフレームで進めるステップ数を返す。返した数のぶんは積み立てから引いてある */
  advance(dt: number): number {
    if (dt > 0 && Number.isFinite(dt)) this.acc += dt;
    let n = 0;
    while (this.acc >= this.step && n < this.maxSteps) {
      this.acc -= this.step;
      n++;
    }
    if (this.acc >= this.step) this.acc = 0;
    return n;
  }

  /** まだステップにならずに残っている時間（秒、0 以上 step 未満） */
  get remainder(): number {
    return this.acc;
  }

  /** 最後のステップから次のステップまでの位置（0〜1）。描画の補間に使う */
  get alpha(): number {
    return this.acc / this.step;
  }
}
