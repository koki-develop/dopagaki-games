import type { Voice } from './engine.ts';
import { octavePosition, shepardAnchor, shepardWaves } from './shepard.ts';

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

/** Shepard tone の一番低い成分の基準周波数（C3） */
const SHEPARD_BASE = 130.81;
/** Shepard tone を作る成分（1 オクターブ間隔）の数 */
const SHEPARD_COMPONENTS = 4;
/** Shepard tone の音程の揺らぎ（セント） */
const SHEPARD_JITTER = 8;
/** はじく音の出だしの長さ（秒） */
export const PLUCK_ATTACK = 0.002;

/**
 * Shepard tone（上がり続けて聞こえる音）の全成分を、作り置きの PeriodicWave を使う OscillatorNode 1 つで鳴らす。
 * semitones は基準（C）からの半音数で、いくら大きくても負でもよい。揺らぎは、最も近い半音の波形からのずれとして detune で足す。
 * brightness が 0.6 を超えると、倍音の多い三角波の成分にする
 */
export function shepardOsc(v: Voice, t: number, semitones: number, brightness: number, stopAt: number, dest: AudioNode): OscillatorNode {
  const semis = semitones + jitterCents(SHEPARD_JITTER) / 100;
  const anchor = shepardAnchor(semis);
  const wave = shepardWaves(v.ctx, SHEPARD_COMPONENTS).wave(anchor, brightness > 0.6 ? 'triangle' : 'sine');
  const o = oscillator(v, t, wave, SHEPARD_BASE * 2 ** (anchor / 12), stopAt, dest);
  o.detune.value = (octavePosition(semis) - anchor) * 100;
  return o;
}

/** Shepard tone の 1 音をエンベロープ付きで鳴らす */
export function shepardPluck(v: Voice, t: number, semitones: number, decay: number, peak: number, brightness: number, dest: AudioNode = v.out): void {
  const env = envGain(v.ctx, t, PLUCK_ATTACK, decay, peak, dest);
  shepardOsc(v, t, semitones, brightness, stopTime(t, PLUCK_ATTACK, decay), env);
}

/** supersaw の 1 音を 2 本のノコギリ波に分けるデチューン（セント） */
const SUPERSAW_DETUNE = 9;

/**
 * デチューンしたノコギリ波を重ねて、ローパスで削る和音。midis の先頭 count 音を使う。
 * どのノコギリ波も同じエンベロープなので、1 つにまとめてからローパスへつなぐ。
 * ローパスは attack × 4 で cutoff まで開き、dur かけて cutoff の 1/4（200Hz 以上）まで閉じる
 */
export function supersaw(v: Voice, t: number, midis: readonly number[], count: number, dur: number, attack: number, cutoff: number, dest: AudioNode = v.out): void {
  const ctx = v.ctx;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.8;
  lp.frequency.setValueAtTime(cutoff * 0.4, t);
  lp.frequency.exponentialRampToValueAtTime(cutoff, t + Math.max(0.02, attack * 4));
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.25), t + dur);
  lp.connect(dest);
  const env = envGain(ctx, t, attack, dur, 0.34 / Math.sqrt(count * 2), lp);
  const end = stopTime(t, attack, dur);
  for (let i = 0; i < count; i++) {
    const f = midiToFreq(midis[i]);
    oscillator(v, t, 'sawtooth', f, end, env).detune.value = -SUPERSAW_DETUNE + jitterCents(3);
    oscillator(v, t, 'sawtooth', f, end, env).detune.value = SUPERSAW_DETUNE + jitterCents(3);
  }
}

/** 吸い込む音（riserInhale）の音色 */
export type InhaleShape = {
  /** ノイズを通すバンドパスの中心周波数の、始まりと終わり（Hz） */
  readonly noiseFrom: number;
  readonly noiseTo: number;
  /** 重ねるサイン波の音程の、始まりと終わり（Hz） */
  readonly toneFrom: number;
  readonly toneTo: number;
  /** サイン波の音量（ノイズを 1 として） */
  readonly toneLevel: number;
};

/**
 * 溜めの吸い込み音。逆再生のように、t から duration 秒かけて音量と音程が上がり、終わりの瞬間に途切れる。
 * バンドパスを通したノイズとサイン波を 1 つのエンベロープにまとめて鳴らす
 */
export function riserInhale(v: Voice, t: number, duration: number, shape: InhaleShape, dest: AudioNode = v.out): void {
  const ctx = v.ctx;
  const end = t + duration;
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, t);
  g.gain.exponentialRampToValueAtTime(1, end - 0.01);
  g.gain.linearRampToValueAtTime(SILENT, end);
  g.connect(dest);
  const src = ctx.createBufferSource();
  src.buffer = v.noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.2;
  bp.frequency.setValueAtTime(shape.noiseFrom, t);
  bp.frequency.exponentialRampToValueAtTime(shape.noiseTo, end);
  src.connect(bp).connect(g);
  src.start(t, Math.random() * 0.5);
  src.stop(end);
  v.track(src);
  const og = ctx.createGain();
  og.gain.value = shape.toneLevel;
  og.connect(g);
  oscillator(v, t, 'sine', shape.toneFrom, end, og).frequency.exponentialRampToValueAtTime(shape.toneTo, end);
}

/**
 * voice の出力を、amount の量だけ共通の残響へ送る。voice を止めると送りも止まる（残響の尾は残る）。
 * 送りは voice が鳴り終わったら残響から切り離す。
 * 共通の残響は効果音のバスへ出て silence() で消えるので、lead の音には使わない
 */
export function send(v: Voice, amount: number): void {
  const g = v.ctx.createGain();
  g.gain.value = amount;
  v.out.connect(g);
  g.connect(v.reverb);
  v.own(g);
}

/**
 * 歪ませる入口を作る。入口へつないだ音を pre 倍してから共通の曲線で頭を潰し、dest へ出す。
 * 打撃音の胴鳴りや低音を太く、前へ出すのに使う
 */
export function drive(v: Voice, pre: number, dest: AudioNode = v.out): GainNode {
  const input = v.ctx.createGain();
  input.gain.value = pre;
  const shaper = v.ctx.createWaveShaper();
  shaper.curve = v.drive;
  shaper.oversample = '2x';
  input.connect(shaper);
  shaper.connect(dest);
  return input;
}
