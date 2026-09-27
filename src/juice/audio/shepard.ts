/** ペンタトニック（メジャー）の音階。C D E G A */
export const PENTATONIC = [0, 2, 4, 7, 9] as const;

/** 音階の step 番目の音の、基準音からの半音数（無限に上がる） */
export function pentatonicSemitones(step: number): number {
  const n = PENTATONIC.length;
  const octave = Math.floor(step / n);
  const degree = ((step % n) + n) % n;
  return octave * 12 + PENTATONIC[degree];
}

/*
 * Shepard tone（無限音階）:
 * 1 オクターブ間隔の成分を components 個重ね、対数周波数上の釣鐘型の重みで音量を決める。
 * 成分 k（k = 0 … components-1）の周波数は baseFreq · 2^(k + h)。h はオクターブ内の位置（0 以上 1 未満）。
 * 半音数が 12 上がると成分が 1 つずつ上へずれ、元と同じ音色に戻るので、上がり続けて聞こえる。
 */

/** 釣鐘型の重みの広がり（成分の並びを 0〜1 としたときの標準偏差） */
const SHEPARD_SIGMA = 0.2;

/** 半音数（いくら大きくても負でもよい）の、オクターブ内の位置（半音単位、0 以上 12 未満） */
export function octavePosition(semitones: number): number {
  return ((semitones % 12) + 12) % 12;
}

/** オクターブ内の位置が h（0〜1）のときの、成分 k の重み */
export function shepardWeight(k: number, h: number, components: number): number {
  const d = (k + h) / components - 0.5;
  return Math.exp(-(d * d) / (2 * SHEPARD_SIGMA * SHEPARD_SIGMA));
}

export type ShepardWaveform = 'sine' | 'triangle';

/**
 * 波形の係数を何倍音まで持つか。一番低い成分（C3 ≒ 131Hz）でも、サンプリング周波数 192kHz のナイキスト周波数を超える。
 */
export const SHEPARD_HARMONICS = 1024;

/**
 * Shepard tone 全体を 1 周期の波形として表す PeriodicWave の係数（sin の項）を imag に書く。
 *
 * 基本周波数を baseFreq · 2^(anchor/12) とすると、成分 k はちょうど 2^k 倍音になる。
 * - sine: 2^k 倍音の係数が成分 k の重み
 * - triangle: 標準の triangle 波形の係数 b[m] = 8 sin(mπ/2) / (πm)²（奇数 m）を、成分 k の重みを掛けて m·2^k 倍音に置く。
 *   整数は「奇数 × 2 の累乗」にただ 1 通りに分解できるので、成分どうしの倍音は重ならない
 *
 * どの項も sin で、時刻 0 で位相 0。OscillatorNode の標準の波形と同じ向きなので、
 * 成分ごとに OscillatorNode を同時に start した和と同じ波形になる（正規化を切って使う前提）。
 *
 * @param anchor 基準音からの半音数（0〜12）
 * @param imag 長さ SHEPARD_HARMONICS + 1 以上。0 で埋めてから書く
 */
export function shepardWaveCoefficients(anchor: number, components: number, type: ShepardWaveform, imag: Float32Array): void {
  imag.fill(0);
  const h = anchor / 12;
  const harmonics = imag.length - 1;
  for (let k = 0; k < components; k++) {
    const w = shepardWeight(k, h, components);
    const n0 = 2 ** k;
    if (type === 'sine') {
      if (n0 <= harmonics) imag[n0] += w;
      continue;
    }
    for (let m = 1; m * n0 <= harmonics; m += 2) {
      const sign = (m - 1) % 4 === 0 ? 1 : -1;
      imag[m * n0] += (w * sign * 8) / (Math.PI * Math.PI * m * m);
    }
  }
}

/** 1 オクターブの中の位置を、半音ごとの目印（0〜12）にまとめる数。12 は次のオクターブの 0 と同じ高さ */
const ANCHORS = 13;
const WAVEFORMS: readonly ShepardWaveform[] = ['sine', 'triangle'];

/**
 * Shepard tone の PeriodicWave を、半音ごとの目印 × 波形の種類で作り置きする。
 * 1 つの音を OscillatorNode 1 つで鳴らし、目印からのずれは detune で足す。
 */
class ShepardWaves {
  private readonly ctx: BaseAudioContext;
  private readonly components: number;
  private readonly waves: (PeriodicWave | null)[] = new Array<PeriodicWave | null>(ANCHORS * WAVEFORMS.length).fill(null);
  private readonly imag = new Float32Array(SHEPARD_HARMONICS + 1);
  private readonly real = new Float32Array(SHEPARD_HARMONICS + 1);

  constructor(ctx: BaseAudioContext, components: number) {
    this.ctx = ctx;
    this.components = components;
  }

  /** anchor（0〜12 の整数）の波形。初回だけ作る */
  wave(anchor: number, type: ShepardWaveform): PeriodicWave {
    const index = anchor * WAVEFORMS.length + (type === 'sine' ? 0 : 1);
    const cached = this.waves[index];
    if (cached) return cached;
    shepardWaveCoefficients(anchor, this.components, type, this.imag);
    // 重みの大きさをそのまま使うため、正規化は切る
    const wave = this.ctx.createPeriodicWave(this.real, this.imag, { disableNormalization: true });
    this.waves[index] = wave;
    return wave;
  }
}

const banks = new WeakMap<BaseAudioContext, Map<number, ShepardWaves>>();

/** AudioContext ごとに 1 つの ShepardWaves。PeriodicWave は作った AudioContext でしか使えない */
export function shepardWaves(ctx: BaseAudioContext, components: number): ShepardWaves {
  let byCount = banks.get(ctx);
  if (!byCount) {
    byCount = new Map();
    banks.set(ctx, byCount);
  }
  let bank = byCount.get(components);
  if (!bank) {
    bank = new ShepardWaves(ctx, components);
    byCount.set(components, bank);
  }
  return bank;
}

/**
 * semitones の Shepard tone を鳴らすための目印（最も近い半音、0〜12）。
 * detune は (octavePosition(semitones) - anchor) × 100 セント（±50 以内）。
 * 基本周波数 baseFreq · 2^(anchor/12) · 2^(detune/1200) = baseFreq · 2^h なので、成分の周波数は定義どおりになる。
 */
export function shepardAnchor(semitones: number): number {
  return Math.round(octavePosition(semitones));
}
