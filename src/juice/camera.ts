import { clamp01, easeOutCubic, ramp } from '../shared/math.ts';
import { Noise1D } from './noise.ts';

export type CameraOffset = {
  x: number;
  y: number;
  /** ラジアン */
  rotation: number;
  /** 1 が基準。1 より小さいと引き（広く映る）、大きいと寄り */
  zoom: number;
};

/**
 * カメラの動きの種類ごとの倍率（0 で止める、1 でそのまま）。ユーザー設定から決める（GameSettings.cameraMotion）
 * - shake: 衝撃による揺れ（trauma）
 * - pulse: ビートに合わせた拍動
 * - pull: 大きな節目で引いて戻るズーム
 * - punch: 衝撃に伴って引いて戻るズーム。揺れの一部として扱う
 * - jolt: 衝撃に伴う画面上の効果（ヒットストップの震え、RGB のずれなど）。揺れの一部として扱う。CameraRig は使わず、描画や演出が読む
 */
export type CameraMotion = {
  shake: number;
  pulse: number;
  pull: number;
  punch: number;
  jolt: number;
};

type CameraRigOptions = {
  /** trauma 1 のときの最大の平行移動（ワールド単位） */
  maxOffset: number;
  /** trauma 1 のときの最大の回転（ラジアン） */
  maxRotation: number;
  /** trauma の 1 秒あたりの減少量 */
  decayPerSecond: number;
  /** ノイズを進める速さ（1 秒あたり） */
  frequency: number;
};

/** punch が true なら CameraMotion.punch、false なら CameraMotion.pull の倍率を掛ける */
type Pull = { amount: number; start: number; attack: number; release: number; punch: boolean };

/**
 * trauma ベースのカメラシェイクと、カメラの引き（ズームアウトして戻る）、ビートに合わせた拍動。1 回のプレイごとに作る。
 * 引きは、大きな節目の引き（pull）と、衝撃に伴う引き（punch）の 2 種類で、ユーザー設定による倍率を別々に掛ける。
 * 揺れは trauma² に比例させ、Perlin ノイズから取り、世界時間で進める。
 * 世界が止まると揺れも止まり、スローモーションでは揺れもゆっくりになる。
 */
export class CameraRig {
  trauma = 0;
  private readonly opts: CameraRigOptions;
  private readonly nx = new Noise1D(11);
  private readonly ny = new Noise1D(23);
  private readonly nr = new Noise1D(37);
  private readonly pulls: Pull[] = [];
  private time = 0;
  /** 0〜1。ビートの直後に 1 になり、減衰していく値を外から入れる */
  beatEnvelope = 0;
  /** ビートの拍動の強さ（zoom の増分） */
  beatAmount = 0;

  constructor(opts: CameraRigOptions) {
    this.opts = opts;
  }

  addTrauma(amount: number): void {
    this.trauma = clamp01(this.trauma + amount);
  }

  /** 大きな節目で、amount だけ引いて（zoom を下げて）から戻す。時間は世界時間の秒 */
  pull(amount: number, attack: number, release: number): void {
    this.pulls.push({ amount, start: this.time, attack, release, punch: false });
  }

  /** 衝撃に伴って、amount だけ引いてから戻す。揺れの一部として扱う。時間は世界時間の秒 */
  punch(amount: number, attack: number, release: number): void {
    this.pulls.push({ amount, start: this.time, attack, release, punch: true });
  }

  update(worldDt: number): void {
    this.time += worldDt;
    this.trauma = Math.max(0, this.trauma - this.opts.decayPerSecond * worldDt);
    for (let i = this.pulls.length - 1; i >= 0; i--) {
      const p = this.pulls[i];
      if (this.time - p.start >= p.attack + p.release) this.pulls.splice(i, 1);
    }
  }

  /** 現在のカメラのずれ。動きの種類ごとに motion の倍率を掛ける */
  sample(motion: Readonly<CameraMotion>, out: CameraOffset): CameraOffset {
    const shake = this.trauma * this.trauma * motion.shake;
    const t = this.time * this.opts.frequency;
    out.x = this.opts.maxOffset * shake * this.nx.sample(t);
    out.y = this.opts.maxOffset * shake * this.ny.sample(t + 100);
    out.rotation = this.opts.maxRotation * shake * this.nr.sample(t + 200);
    let pull = 0;
    for (const p of this.pulls) {
      const e = this.time - p.start;
      const k = e < p.attack ? easeOutCubic(e / p.attack) : 1 - easeOutCubic(ramp(e - p.attack, p.release));
      pull += p.amount * k * (p.punch ? motion.punch : motion.pull);
    }
    out.zoom = 1 - Math.min(0.35, pull) + this.beatAmount * this.beatEnvelope * motion.pulse;
    return out;
  }
}
