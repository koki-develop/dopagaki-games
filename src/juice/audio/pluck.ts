/**
 * 弦をはじいた音（Karplus–Strong）。はじいた瞬間の波形（ノイズ）を弦の長さの遅延に入れて回し、回るたびに少しずつ丸めて減らす。
 * 本物の弦の、はじいた直後に明るく、高い音から先に消えていく響きになる。
 * 波形はあらかじめ計算して AudioBuffer にし（pluckBuffer）、同じ弦と高さはコンテキストごとに使い回す。
 */

/** 弦の性質 */
export type PluckString = {
  /** 名前（使い回しの見出し） */
  readonly name: string;
  /** 基音が 1/1000（−60 dB）に減るまで（秒） */
  readonly t60: number;
  /** はじいた瞬間の明るさ（0〜1）。小さいほど指の腹で柔らかくはじいた音 */
  readonly brightness: number;
  /** はじく位置（弦の長さに対する割合）。その位置で節になる倍音が抜ける */
  readonly pickPosition: number;
  /** 計算する長さ（秒） */
  readonly seconds: number;
};

/** 再現できるように、乱数は決まった種から作る（線形合同法） */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * 周波数 freq の弦をはじいた波形を out に書く（out の長さだけ）。振幅の最大はおよそ 1。
 * 遅延の端数は 1 次のオールパスで合わせ、回るたびの平均（半サンプル遅れ）の分も差し引いて、音程を合わせる
 */
export function karplusStrong(out: Float32Array, sampleRate: number, freq: number, s: PluckString, seed: number): void {
  const period = sampleRate / freq;
  const len = Math.max(2, Math.floor(period - 0.5));
  const frac = period - 0.5 - len;
  const c = (1 - frac) / (1 + frac);
  const line = new Float32Array(len);
  // はじいた瞬間の波形: ノイズを明るさに応じて 2 回なめらかにし、はじく位置の櫛形で倍音を抜き、直流を除く
  const rnd = lcg(seed);
  const a = 0.05 + 0.95 * s.brightness * s.brightness;
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < len; i++) {
    lp1 += a * (rnd() * 2 - 1 - lp1);
    lp2 += a * (lp1 - lp2);
    line[i] = lp2;
  }
  const pick = Math.max(1, Math.round(len * s.pickPosition));
  const excite = new Float32Array(len);
  let mean = 0;
  for (let i = 0; i < len; i++) {
    excite[i] = line[i] - line[(i - pick + len) % len];
    mean += excite[i];
  }
  mean /= len;
  let peak = 1e-9;
  for (let i = 0; i < len; i++) {
    excite[i] -= mean;
    peak = Math.max(peak, Math.abs(excite[i]));
  }
  for (let i = 0; i < len; i++) line[i] = excite[i] / peak;
  // 1 周ごとの減り方: 基音が t60 秒で −60 dB
  const rho = 10 ** (-3 / (s.t60 * freq));
  let idx = 0;
  let prev = 0;
  let apIn = 0;
  let apOut = 0;
  for (let n = 0; n < out.length; n++) {
    const cur = line[idx];
    out[n] = cur;
    const avg = 0.5 * (cur + prev);
    prev = cur;
    const ap = c * avg + apIn - c * apOut;
    apIn = avg;
    apOut = ap;
    line[idx] = ap * rho;
    idx = idx + 1 === len ? 0 : idx + 1;
  }
}

/** コンテキストごとの、計算した波形。見出しは弦の名前と MIDI 番号 */
const cache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/** 弦 s を MIDI 番号 midi の高さではじいた波形の AudioBuffer。初めての弦と高さだけ計算する */
export function pluckBuffer(ctx: BaseAudioContext, s: PluckString, midi: number): AudioBuffer {
  let byKey = cache.get(ctx);
  if (!byKey) {
    byKey = new Map();
    cache.set(ctx, byKey);
  }
  const key = `${s.name}:${midi}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.ceil(rate * s.seconds), rate);
  karplusStrong(buffer.getChannelData(0), rate, 440 * 2 ** ((midi - 69) / 12), s, 0x9e3779b9 ^ (midi * 2654435761));
  byKey.set(key, buffer);
  return buffer;
}

/**
 * 部屋の響きのインパルス応答を、左右のチャンネル（channels）に書く。左右で別のノイズを、指数的に減らしながら、
 * 時間が経つほど高い音を先に丸める（壁に吸われる）。seconds は −60 dB まで
 */
export function roomImpulse(channels: readonly Float32Array[], sampleRate: number, seconds: number): void {
  const k = Math.log(1000) / (seconds * sampleRate);
  channels.forEach((data, ch) => {
    const rnd = lcg(0x5bd1e995 + ch * 0x27d4eb2d);
    let lp = 0;
    for (let i = 0; i < data.length; i++) {
      const age = i / data.length;
      // 始めは明るく、終わりほどこもる
      const a = 0.9 - 0.75 * age;
      lp += a * (rnd() * 2 - 1 - lp);
      data[i] = lp * Math.exp(-k * i);
    }
    // 直接音と重ならないよう、頭の 5 ms をなめらかに立ち上げる
    const rise = Math.min(data.length, Math.floor(sampleRate * 0.005));
    for (let i = 0; i < rise; i++) data[i] *= i / rise;
  });
}
