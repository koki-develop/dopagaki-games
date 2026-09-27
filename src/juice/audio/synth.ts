import type { Voice } from './engine.ts';

/**
 * 音色づくりの部品。どれも voice の出力へつなぎ、voice に登録して一緒に止められるようにする。
 * 毎フレーム鳴る音でも余計なオブジェクトを作らないよう、引数は数値で受け取る。
 * exponentialRamp は 0 を受け付けないので、無音へ向かうときは SILENT まで下げる。
 */
const SILENT = 0.0001;

/** 音源を止めるのを、エンベロープが消え切ってから少し待つ（秒） */
const TAIL = 0.02;

/** attack 秒で peak まで上がり、decay 秒で指数的に消えるエンベロープを持つ GainNode を作る */
export function envGain(ctx: BaseAudioContext, t: number, attack: number, decay: number, peak: number, dest: AudioNode): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.max(0.001, attack));
  g.gain.exponentialRampToValueAtTime(SILENT, t + attack + decay);
  g.connect(dest);
  return g;
}

/** エンベロープの長さに合わせた、音源を止める時刻 */
export const stopTime = (t: number, attack: number, decay: number): number => t + attack + decay + TAIL;

/**
 * エンベロープを持たない OscillatorNode を t から stopAt まで鳴らす。
 * 同じエンベロープを共有する複数の音源は、1 つの envGain にまとめてつなぐ。
 */
export function oscillator(
  v: Voice,
  t: number,
  wave: OscillatorType | PeriodicWave,
  freq: number,
  stopAt: number,
  dest: AudioNode,
): OscillatorNode {
  const node = v.ctx.createOscillator();
  if (typeof wave === 'string') node.type = wave as OscillatorType;
  else node.setPeriodicWave(wave);
  node.frequency.setValueAtTime(freq, t);
  node.connect(dest);
  node.start(t);
  node.stop(stopAt);
  v.track(node);
  return node;
}

/** 自分専用のエンベロープを持つ OscillatorNode。音程を動かすときは戻り値の frequency に glide() する */
export function tone(
  v: Voice,
  t: number,
  wave: OscillatorType | PeriodicWave,
  freq: number,
  attack: number,
  decay: number,
  peak: number,
  dest: AudioNode = v.out,
): OscillatorNode {
  const env = envGain(v.ctx, t, attack, decay, peak, dest);
  return oscillator(v, t, wave, freq, stopTime(t, attack, decay), env);
}

/** param を endTime までに to へ指数的に動かす（周波数用。1 未満にはしない） */
export function glide(param: AudioParam, to: number, endTime: number): void {
  param.exponentialRampToValueAtTime(Math.max(1, to), endTime);
}

/**
 * フィルタを通したノイズ。offset はノイズバッファの読み出し位置（秒）で、ずらすと毎回違う質感になる。
 * フィルタの周波数を動かすときは、戻り値の frequency に glide() する。
 */
export function noise(
  v: Voice,
  t: number,
  filter: BiquadFilterType,
  freq: number,
  q: number,
  attack: number,
  decay: number,
  peak: number,
  offset: number,
  dest: AudioNode = v.out,
): BiquadFilterNode {
  const ctx = v.ctx;
  const src = ctx.createBufferSource();
  src.buffer = v.noise;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  f.Q.value = q;
  src.connect(f).connect(envGain(ctx, t, attack, decay, peak, dest));
  const dur = attack + decay + TAIL;
  const maxOffset = Math.max(0, v.noise.duration - dur - 0.01);
  src.start(t, Math.min(maxOffset, offset));
  src.stop(t + dur);
  v.track(src);
  return f;
}

/** BiquadFilterNode の Q の既定値 */
export const DEFAULT_Q = 0.7;

/** ランダムなピッチの揺らぎ（セント） */
export const jitterCents = (amount: number): number => (Math.random() * 2 - 1) * amount;

export const midiToFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
