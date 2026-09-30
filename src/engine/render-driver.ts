import type { FatalCause } from '../shared/fatal.ts';
import { FrameLoop } from './frame-loop.ts';
import type { FrameTarget, LoopFrame } from './frame-loop.ts';
import { QUALITY_LEVELS, QualityGovernor } from './quality.ts';
import type { QualityLevel } from './quality.ts';
import type { RenderHost } from './render-host.ts';

/** 描画一式。本番では RenderHost と PostChain（post-graphics.ts）。GPU を失ったら捨てて作り直す */
export type DriverGraphics = FrameTarget & {
  readonly backend: string;
  /** 開発用の操作口に出す RenderHost。代役では null */
  readonly host: RenderHost | null;
  /** 描画領域の CSS ピクセルの大きさ */
  setSize(cssWidth: number, cssHeight: number): void;
  setQuality(q: QualityLevel): void;
  /** パイプラインを前もってコンパイルし、1 フレーム描画する。最初の描画でコンパイル待ちが起きないように */
  warmUp(): Promise<void>;
  dispose(): void;
};

export type GraphicsEvents = {
  /** GPU を失った。一度だけ呼ぶ */
  onLost(): void;
  /** 描画バッファの大きさが変わった */
  onResize(): void;
};

/** RenderDriver から呼ばれる相手（ゲームのセッション） */
type DriverClient<G> = {
  /**
   * 描画一式ができた（初回と、GPU を失って作り直したとき）。大きさと品質は反映してある。
   * このあと warmUp で 1 フレーム描くので、ここで今の状態を描画用のデータへ書き出しておく
   */
  attach(graphics: G): void;
  /** GPU を失った。描画一式を捨てる直前に呼ぶ */
  detach(): void;
  /** 品質の段階が変わった。描画一式ができたときにも、attach の前に 1 回呼ぶ */
  quality(q: QualityLevel): void;
  /** 1 フレーム進めて描画用のデータを書き出す。絵が変わったら true */
  update(frame: Readonly<LoopFrame>): boolean;
  /** 続けられなくなった。フレームのループはもう止まっている。1 回だけ呼び、以後は何も呼ばない */
  fail(cause: Exclude<FatalCause, 'init'>, error: unknown): void;
};

type DriverOptions<G> = {
  /** 描画一式を作る。失敗したら投げる */
  createGraphics(events: GraphicsEvents): Promise<G>;
  client: DriverClient<G>;
  /** 今の時刻（ms、performance.now() の時間軸） */
  now(): number;
};

/**
 * 描画一式とフレームのループの持ち主。どのゲームのセッションも、これを通して描画する。
 *
 * - 描画一式を作り、品質と大きさを反映し、パイプラインを前もってコンパイルしてから、フレームのループを回す
 * - 描画しないフレームも含めて、品質の判定（QualityGovernor）を続ける。判定は GPU を作り直しても引き継ぐ
 * - GPU を失ったら、ループを止めて描画一式を作り直す。作り直せなければ lost として 1 回だけ知らせる
 * - フレームの処理で例外が投げられたら、ループを止めて internal として 1 回だけ知らせる
 */
export class RenderDriver<G extends DriverGraphics> {
  private readonly opts: DriverOptions<G>;
  private readonly governor = new QualityGovernor(QUALITY_LEVELS.length - 1);
  private graphicsValue: G | null = null;
  private loop: FrameLoop | null = null;
  /** 描画一式を作るたびに増やす。古い描画一式からの知らせと、途中で追い越された作り直しを捨てる */
  private generation = 0;
  private width = 1;
  private height = 1;
  private failed = false;
  private disposed = false;

  constructor(opts: DriverOptions<G>) {
    this.opts = opts;
  }

  /** 今の描画一式。作る前と、GPU を失ってから作り直すまでは null */
  get graphics(): G | null {
    return this.graphicsValue;
  }

  /** 今の品質の段階（0 が最高品質） */
  get qualityLevel(): number {
    return this.governor.level;
  }

  /**
   * 最初の描画一式を作り、ループを回し始める。準備（パイプラインのコンパイルと最初の描画）が済んだら解決する。
   * 作れなければ投げる。途中で dispose されたら、作ったものを捨てて解決する
   */
  start(): Promise<void> {
    return this.attach();
  }

  /** 描画領域の大きさ（CSS ピクセル）。覚えておき、作り直した描画一式にも反映する */
  setSize(cssWidth: number, cssHeight: number): void {
    this.width = cssWidth;
    this.height = cssHeight;
    this.graphicsValue?.setSize(cssWidth, cssHeight);
    this.invalidate();
  }

  /** 次のフレームを必ず描く */
  invalidate(): void {
    this.loop?.invalidate();
  }

  /** ループを止め、描画一式を捨てる。以後は何もしない。何度呼んでもよい */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.loop?.stop();
    this.loop = null;
    this.graphicsValue?.dispose();
    this.graphicsValue = null;
  }

  private get alive(): boolean {
    return !this.disposed && !this.failed;
  }

  private readonly frameClient = {
    onQualityChange: (level: number): void => this.applyQuality(level),
    update: (frame: Readonly<LoopFrame>): boolean => this.opts.client.update(frame),
    onError: (error: unknown): void => this.fail('internal', error),
  };

  private applyQuality(level: number): void {
    const q = QUALITY_LEVELS[Math.min(QUALITY_LEVELS.length - 1, Math.max(0, level))];
    this.graphicsValue?.setQuality(q);
    this.opts.client.quality(q);
    this.invalidate();
  }

  /**
   * 描画一式を作り、品質と大きさを反映して、パイプラインを前もってコンパイルし、ループを回し始める。
   * 初回と、GPU を失ったときに呼ぶ。途中で別の作り直しに追い越されたら、作ったものを捨てる。
   */
  private async attach(): Promise<void> {
    const gen = ++this.generation;
    const stale = () => !this.alive || gen !== this.generation;
    try {
      const g = await this.opts.createGraphics({
        onLost: () => {
          if (!stale()) void this.recover();
        },
        onResize: () => {
          if (!stale()) this.invalidate();
        },
      });
      if (stale()) {
        g.dispose();
        return;
      }
      this.graphicsValue = g;
      g.setSize(this.width, this.height);
      this.applyQuality(this.governor.level);
      this.opts.client.attach(g);
      await g.warmUp();
      if (stale()) return;
      const loop = new FrameLoop({ target: g, governor: this.governor, client: this.frameClient, now: this.opts.now });
      this.loop = loop;
      loop.start();
    } catch (e) {
      // 追い越された作り直しの失敗は、今の描画に関係ないので知らせない
      if (!stale()) throw e;
    }
  }

  /**
   * GPU を失った。描画一式とループを作り直す（品質の判定は同じものを使い続ける）。
   * 作り直せなければ、致命的な失敗（lost）として知らせる。detach が投げたら internal として知らせる
   */
  private async recover(): Promise<void> {
    if (!this.alive) return;
    this.loop?.stop();
    this.loop = null;
    try {
      this.opts.client.detach();
    } catch (e) {
      this.fail('internal', e);
      return;
    }
    this.graphicsValue?.dispose();
    this.graphicsValue = null;
    try {
      await this.attach();
    } catch (e) {
      this.fail('lost', e);
    }
  }

  private fail(cause: Exclude<FatalCause, 'init'>, error: unknown): void {
    if (!this.alive) return;
    this.failed = true;
    this.loop?.stop();
    this.loop = null;
    this.opts.client.fail(cause, error);
  }
}
