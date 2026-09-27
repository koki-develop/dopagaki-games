export type QualityLevel = {
  /** devicePixelRatio の上限 */
  pixelRatio: number;
  /** bloom の解像度の倍率 */
  bloomScale: number;
  /** パーティクル・破片の予算（発生数と同時に存在できる数の倍率） */
  particles: number;
};

/** 描画品質の段階。負荷が高い端末では、下の段階へ順に落としていく */
export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { pixelRatio: 2, bloomScale: 0.5, particles: 1 },
  { pixelRatio: 1.5, bloomScale: 0.5, particles: 0.85 },
  { pixelRatio: 1.25, bloomScale: 0.4, particles: 0.65 },
  { pixelRatio: 1, bloomScale: 0.33, particles: 0.5 },
  { pixelRatio: 0.85, bloomScale: 0.25, particles: 0.4 },
];

/** 端末のリフレッシュ間隔として採る値（秒）。30 / 60 / 90 / 120Hz */
const STANDARD_INTERVALS: readonly number[] = [1 / 120, 1 / 90, 1 / 60, 1 / 30];

/** これより長いフレーム間隔は、タブの切り替えなどで空いた時間とみなして無視する（秒） */
const MAX_SAMPLE_DT = 0.25;

/** 間隔 dt に最も近い標準の間隔。比が tolerance を超えて離れていたら 0 */
export function snapInterval(dt: number, tolerance: number): number {
  let best = 0;
  let bestErr = Infinity;
  for (const s of STANDARD_INTERVALS) {
    const err = Math.abs(Math.log(dt / s));
    if (err < bestErr) {
      bestErr = err;
      best = s;
    }
  }
  return bestErr <= Math.log(1 + tolerance) ? best : 0;
}

type GovernorTuning = {
  /** リフレッシュ間隔の実測に使う、何も描かないフレームの数 */
  calibrationFrames: number;
  /** 目標の間隔の何倍を超えたら遅いフレームとみなすか */
  slowRatio: number;
  /** 目標の間隔の何倍未満なら余裕のあるフレームとみなすか */
  fastRatio: number;
  /** 遅いフレームの時間がこれだけ溜まったら 1 段階下げる（秒） */
  downgradeAfter: number;
  /** 余裕のある状態がこれだけ続いたら 1 段階上げる（秒）。上げ直しに失敗するたびに倍にする */
  upgradeAfter: number;
  /** 上げ直しの待ち時間の上限（秒） */
  upgradeAfterMax: number;
  /** 上げてからこの時間（描画した時間の合計、秒）以内に下げることになったら、上げ直しは失敗とみなす */
  upgradeProbation: number;
  /** 段階を変えたあと、判定を休む時間（秒） */
  cooldown: number;
  /**
   * フレーム間隔の傾向を見る窓の大きさ（フレーム数）。
   * 30Hz で downgradeAfter 秒ぶんのフレーム数以下にして、下げる判定の時点で窓が遅いフレームで埋まっているようにする
   */
  window: number;
  /** 窓の間隔が標準の間隔に揃っているとみなす、比のずれ */
  cadenceTolerance: number;
  /** 窓のうち、この割合以上が同じ標準の間隔に揃っていたら、その間隔で安定して回っているとみなす */
  cadenceAgreement: number;
};

const DEFAULT_GOVERNOR_TUNING: GovernorTuning = {
  calibrationFrames: 30,
  slowRatio: 1.35,
  fastRatio: 1.08,
  downgradeAfter: 1.5,
  upgradeAfter: 8,
  upgradeAfterMax: 128,
  upgradeProbation: 12,
  cooldown: 2,
  window: 40,
  cadenceTolerance: 0.1,
  cadenceAgreement: 0.8,
};

/**
 * フレーム時間を見て、描画品質の段階を決める。DOM にも three.js にも依存しない。
 *
 * 1. 何も描かないフレームの間隔を `calibrate()` で測り、端末のリフレッシュ間隔（30 / 60 / 90 / 120Hz）を目標の間隔にする
 * 2. 描画したフレームの間隔を `sample(dt, true)` で受け取る。目標を大きく超える時間が溜まったら 1 段階下げ、
 *    余裕のある状態が長く続いたら 1 段階上げる
 * 3. 下げたとき、フレームがより遅い標準の間隔（例: 30Hz）にぴったり揃っていたら、下げた効果を確かめる。
 *    間隔が変わらなければさらに下げ、最低の段階まで下げても変わらなければ、描画の重さではなく端末側の上限
 *    （省電力モードなど）なので、下げたぶんをすべて戻し、目標をその間隔に合わせ直す。間隔が変われば、その段階に留まる
 * 4. 描画しないフレーム（`sample(dt, false)`）はリフレッシュ間隔の観測だけに使い、段階は変えない。
 *    より速い標準の間隔で安定して回っていたら、目標をその間隔へ戻す（省電力モードの解除など）
 * 5. 上げ直した段階がすぐに重すぎると分かったら、次に上げるまでの待ち時間を倍にする（指数バックオフ）。
 *    上げ直しが定着したら、待ち時間を半分に戻していく
 *
 * `MAX_SAMPLE_DT` を超える間隔は無視する。dt は上限で切っていない生の値を渡す。
 */
export class QualityGovernor {
  private readonly maxLevel: number;
  private readonly t: GovernorTuning;
  private levelValue = 0;
  private targetValue = 1 / 60;
  private calibratedValue = false;
  private readonly calib: Float64Array;
  private calibCount = 0;
  private readonly win: Float64Array;
  private readonly winSorted: Float64Array;
  private winCount = 0;
  private winHead = 0;
  private slowTime = 0;
  private fastTime = 0;
  private cooldown = 0;
  private upgradeDelay: number;
  /** 最後に上げてからの描画時間。上げていない、または見極めが済んだら負 */
  private sinceUpgrade = -1;
  /** 下げた効果の見極め中なら、下げる前の段階と、そのときの間隔 */
  private probeFrom = -1;
  private probeInterval = 0;

  constructor(maxLevel: number, tuning: Partial<GovernorTuning> = {}) {
    this.maxLevel = maxLevel;
    this.t = { ...DEFAULT_GOVERNOR_TUNING, ...tuning };
    this.upgradeDelay = this.t.upgradeAfter;
    this.calib = new Float64Array(this.t.calibrationFrames);
    this.win = new Float64Array(this.t.window);
    this.winSorted = new Float64Array(this.t.window);
  }

  /** 今の段階（0 が最高品質） */
  get level(): number {
    return this.levelValue;
  }

  /** 目標のフレーム間隔（秒） */
  get target(): number {
    return this.targetValue;
  }

  /** リフレッシュ間隔の実測が済んだか */
  get calibrated(): boolean {
    return this.calibratedValue;
  }

  /**
   * 何も描かないフレームの間隔を渡して、リフレッシュ間隔を測る。済んだら（済んでいたら）true。
   * 中央値を標準の間隔に寄せる。どれからも 10% 以上離れていたら、中央値をそのまま使う
   */
  calibrate(rawDt: number): boolean {
    if (this.calibratedValue) return true;
    if (!(rawDt > 0) || rawDt > MAX_SAMPLE_DT) return false;
    this.calib[this.calibCount++] = rawDt;
    if (this.calibCount < this.calib.length) return false;
    const median = medianOf(this.calib, this.calib.length);
    const snapped = snapInterval(median, this.t.cadenceTolerance);
    this.targetValue = snapped > 0 ? snapped : median;
    this.calibratedValue = true;
    return true;
  }

  /**
   * 1 フレームの間隔を渡す。段階が変わったら true。
   * @param rawDt 生のフレーム間隔（秒）
   * @param rendered その間隔が、描画したフレームのものか（直前のフレームで描画したか）
   */
  sample(rawDt: number, rendered: boolean): boolean {
    if (!this.calibratedValue) return false;
    if (!(rawDt > 0) || rawDt > MAX_SAMPLE_DT) return false;
    if (!rendered) {
      this.observeIdle(rawDt);
      return false;
    }
    this.push(rawDt);
    if (this.sinceUpgrade >= 0) {
      this.sinceUpgrade += rawDt;
      if (this.sinceUpgrade > this.t.upgradeProbation) {
        // 上げ直しが定着した
        this.sinceUpgrade = -1;
        this.upgradeDelay = Math.max(this.t.upgradeAfter, this.upgradeDelay / 2);
      }
    }
    if (this.cooldown > 0) {
      this.cooldown -= rawDt;
      return false;
    }
    if (this.probeFrom >= 0) return this.evaluateProbe();

    const target = this.targetValue;
    if (rawDt > target * this.t.slowRatio) {
      this.slowTime += rawDt;
      this.fastTime = 0;
    } else {
      this.slowTime = Math.max(0, this.slowTime - rawDt * 0.5);
      if (rawDt < target * this.t.fastRatio) this.fastTime += rawDt;
    }

    if (this.slowTime > this.t.downgradeAfter) return this.onSustainedSlow();
    if (this.fastTime > this.upgradeDelay && this.levelValue > 0) {
      this.levelValue--;
      this.sinceUpgrade = 0;
      this.settle();
      return true;
    }
    return false;
  }

  /** 遅いフレームが続いた */
  private onSustainedSlow(): boolean {
    const cadence = this.windowCadence();
    if (this.sinceUpgrade >= 0) {
      // 上げ直しが重すぎた。次に上げるまでの待ち時間を倍にする
      this.sinceUpgrade = -1;
      this.upgradeDelay = Math.min(this.t.upgradeAfterMax, this.upgradeDelay * 2);
    }
    if (this.levelValue >= this.maxLevel) {
      // これ以上は下げられない。より遅い間隔で安定しているなら、その間隔を目標にする
      if (cadence > this.targetValue) this.targetValue = cadence;
      this.settle();
      return false;
    }
    if (cadence > this.targetValue) {
      this.probeFrom = this.levelValue;
      this.probeInterval = cadence;
    }
    this.levelValue++;
    this.settle();
    return true;
  }

  /** 下げたあとの窓が溜まったら、下げた効果があったかを見る */
  private evaluateProbe(): boolean {
    if (this.winCount < this.win.length) return false;
    if (this.windowCadence() !== this.probeInterval) {
      // 間隔が変わった。下げた効果があったので、この段階に留まる
      this.probeFrom = -1;
      return false;
    }
    if (this.levelValue < this.maxLevel) {
      this.levelValue++;
      this.settle();
      return true;
    }
    // 最低の段階でも同じ間隔のまま。端末側の上限なので、下げたぶんを戻して目標を合わせ直す
    const from = this.probeFrom;
    this.probeFrom = -1;
    this.targetValue = this.probeInterval;
    const changed = this.levelValue !== from;
    this.levelValue = from;
    this.settle();
    return changed;
  }

  /** 描画しないフレームの間隔。より速い標準の間隔で安定していたら、目標をそこへ戻す */
  private observeIdle(dt: number): void {
    this.push(dt);
    if (this.winCount < this.win.length) return;
    const cadence = this.windowCadence();
    if (cadence > 0 && cadence !== this.targetValue) {
      this.targetValue = cadence;
      this.probeFrom = -1;
    }
    this.winCount = 0;
    this.winHead = 0;
  }

  /** 段階や目標を変えたあと、判定をやり直す */
  private settle(): void {
    this.slowTime = 0;
    this.fastTime = 0;
    this.cooldown = this.t.cooldown;
    this.winCount = 0;
    this.winHead = 0;
  }

  private push(dt: number): void {
    this.win[this.winHead] = dt;
    this.winHead = (this.winHead + 1) % this.win.length;
    if (this.winCount < this.win.length) this.winCount++;
  }

  /** 窓のフレーム間隔が 1 つの標準の間隔に揃っていれば、その間隔。揃っていなければ 0 */
  private windowCadence(): number {
    const n = this.winCount;
    if (n < this.win.length) return 0;
    const cadence = snapInterval(medianOf(this.win, n, this.winSorted), this.t.cadenceTolerance);
    if (cadence === 0) return 0;
    let agree = 0;
    const lo = cadence / (1 + this.t.cadenceTolerance);
    const hi = cadence * (1 + this.t.cadenceTolerance);
    for (let i = 0; i < n; i++) if (this.win[i] >= lo && this.win[i] <= hi) agree++;
    return agree >= n * this.t.cadenceAgreement ? cadence : 0;
  }
}

/** 先頭 n 個の中央値。scratch があれば並べ替えに使い、なければ src をその場で並べ替える */
function medianOf(src: Float64Array, n: number, scratch?: Float64Array): number {
  let a = src;
  if (scratch) {
    for (let i = 0; i < n; i++) scratch[i] = src[i];
    a = scratch;
  }
  const view = n === a.length ? a : a.subarray(0, n);
  view.sort();
  return n % 2 === 1 ? view[(n - 1) >> 1] : (view[n / 2 - 1] + view[n / 2]) / 2;
}
