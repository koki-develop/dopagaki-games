import * as THREE from 'three/webgpu';

type BackendKind = 'webgpu' | 'webgl2';

type RenderHostOptions = {
  /** トーンマッピングの露出 */
  exposure: number;
  /** 描画前に塗りつぶす色 */
  clearColor: number;
  /** WebGPU が使えても WebGL2 バックエンドを使う */
  forceWebGL: boolean;
  /** GPU を失った（WebGPU の device lost / WebGL の context lost）。一度だけ呼ぶ */
  onLost: () => void;
  /** 描画バッファの大きさが変わった（CSS の大きさ、devicePixelRatio、pixelRatio の上限のどれかが変わった） */
  onResize?: () => void;
};

/**
 * three.js の WebGPURenderer と、その描画先の canvas・大きさを持つ。
 * WebGPU が使えない環境では WebGL2 に自動でフォールバックする。
 *
 * - 深度バッファは作らない（すべてのメッシュが深度テストを使わず、描画順で重ねるため）
 * - ライトは使わない（renderer.lighting を切る）
 * - 描画バッファの大きさは CSS の大きさ × min(devicePixelRatio, pixelRatio の上限)。
 *   devicePixelRatio の変化（ブラウザのズーム、別の画面への移動）も matchMedia で拾う
 * - GPU を失ったら onLost を呼び、以後の描画はしない。呼び出し側でこの RenderHost を捨てて作り直す。
 *   シーンのオブジェクトはそのまま使い回せる
 */
export class RenderHost {
  readonly renderer: THREE.WebGPURenderer;
  readonly canvas: HTMLCanvasElement;
  readonly backend: BackendKind;
  private readonly onResize: (() => void) | undefined;
  private cssWidth = 1;
  private cssHeight = 1;
  private pixelRatioCap = 2;
  private appliedWidth = 0;
  private appliedHeight = 0;
  private appliedRatio = 0;
  private dprQuery: MediaQueryList | null = null;
  private lostFlag = false;
  private disposed = false;

  private constructor(renderer: THREE.WebGPURenderer, onResize: (() => void) | undefined) {
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
    this.onResize = onResize;
  }

  static async create(opts: RenderHostOptions): Promise<RenderHost> {
    const renderer = new THREE.WebGPURenderer({
      antialias: false,
      alpha: false,
      depth: false,
      powerPreference: 'high-performance',
      forceWebGL: opts.forceWebGL,
    });
    // 色相と彩度を保つトーンマッピング。ネオンの色が白く抜けないようにする
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = opts.exposure;
    renderer.setClearColor(opts.clearColor, 1);
    // ライトは使わない（すべてのマテリアルが色を自分で決める）。切っておくと、描画のたびに作る環境のキャッシュキー
    // （ライト・環境マップ・影の設定）を組み立てなくなる
    renderer.lighting.enabled = false;
    try {
      await renderer.init();
    } catch (e) {
      renderer.dispose();
      throw e;
    }
    const host = new RenderHost(renderer, opts.onResize);
    renderer.onDeviceLost = () => {
      if (host.disposed || host.lostFlag) return;
      host.lostFlag = true;
      opts.onLost();
    };
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    host.watchDevicePixelRatio();
    return host;
  }

  /** GPU を失ったか */
  get lost(): boolean {
    return this.lostFlag;
  }

  /** 描画先の CSS ピクセルの大きさ。作ったあと、描画する前に一度呼ぶ */
  setSize(cssWidth: number, cssHeight: number): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.applySize();
  }

  /** pixelRatio の上限（品質の段階から決める） */
  setPixelRatioCap(cap: number): void {
    this.pixelRatioCap = cap;
    this.applySize();
  }

  /**
   * シーンのパイプラインを、描画先 target（null なら canvas）の形式で前もってコンパイルする。
   * 読み込み画面の裏で呼び、最初の描画でコンパイル待ちが起きないようにする
   */
  async warmUp(scene: THREE.Scene, camera: THREE.Camera, target: THREE.RenderTarget | null): Promise<void> {
    if (this.lostFlag || this.disposed) return;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevMRT = r.getMRT();
    // compileAsync は、その時点の描画先（getRenderTarget()）の色の形式でパイプラインを作る
    r.setRenderTarget(target);
    r.setMRT(null);
    try {
      await r.compileAsync(scene, camera);
    } finally {
      r.setRenderTarget(prevTarget);
      r.setMRT(prevMRT);
    }
  }

  /** 毎フレーム呼ぶ関数を登録する（null で止める）。time は rAF のタイムスタンプ（ms）。最初の 1 回は渡されない */
  setAnimationLoop(cb: ((time?: number) => void) | null): void {
    void this.renderer.setAnimationLoop(cb);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
    void this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    this.canvas.remove();
  }

  /** 今の devicePixelRatio から外れたら一度だけ届く問い合わせを作り直す */
  private watchDevicePixelRatio(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  private readonly onDprChange = (): void => {
    if (this.disposed) return;
    this.watchDevicePixelRatio();
    this.applySize();
  };

  /** 大きさを反映する唯一の経路。大きさも pixelRatio も変わっていなければ何もしない */
  private applySize(): void {
    if (this.disposed) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const ratio = Math.min(dpr, this.pixelRatioCap);
    if (this.cssWidth === this.appliedWidth && this.cssHeight === this.appliedHeight && ratio === this.appliedRatio) return;
    this.appliedWidth = this.cssWidth;
    this.appliedHeight = this.cssHeight;
    this.appliedRatio = ratio;
    // pixelRatio と大きさを一度に変える（canvas の style は 100% のまま触らない）
    this.renderer.setDrawingBufferSize(this.cssWidth, this.cssHeight, ratio);
    this.onResize?.();
  }
}
