/**
 * BGM のリズム隊（キック・ベース・ハイハット）の音色。曲ごとに値を決め、ステップの音は bgmKick / bgmBass / bgmHat で鳴らす。
 * 周波数は Hz、長さは秒
 */
import type { StepVoice } from './bgm.ts';
import { DEFAULT_Q, glide, midiToFreq, noise, tone } from './synth.ts';

/** キック: 音程が下がるサイン波と、頭のクリック */
export type KickTone = {
  /** 鳴り始めと、0.09 秒で下がりきる音程 */
  readonly from: number;
  readonly to: number;
  readonly decay: number;
  readonly peak: number;
  /** 頭のクリック（高域のノイズ）の音量 */
  readonly click: number;
};

/** ベース: ローパスが閉じていくノコギリ波と、1 オクターブ下のサイン波 */
export type BassTone = {
  readonly q: number;
  /** ローパスの鳴り始めと、音の長さの終わりで閉じきる周波数 */
  readonly open: number;
  readonly closed: number;
  readonly sawPeak: number;
  readonly subPeak: number;
};

/** ハイハット: ハイパスを通した短いノイズ */
export type HatTone = {
  readonly cutoff: number;
  readonly decay: number;
  readonly peak: number;
};

/** 層 layer にキックを 1 つ鳴らす */
export function bgmKick(voice: StepVoice, layer: number, k: KickTone): void {
  const v = voice(0.4, 1, layer);
  if (!v) return;
  glide(tone(v, v.start, 'sine', k.from, 0.002, k.decay, k.peak).frequency, k.to, v.start + 0.09);
  noise(v, v.start, 'highpass', 3000, DEFAULT_Q, 0.001, 0.01, k.click, 0);
}

/** 層 layer に、MIDI 番号 midi のベースを len 秒鳴らす */
export function bgmBass(voice: StepVoice, layer: number, midi: number, len: number, b: BassTone): void {
  const v = voice(len + 0.05, 1, layer);
  if (!v) return;
  const lp = v.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = b.q;
  lp.frequency.setValueAtTime(b.open, v.start);
  lp.frequency.exponentialRampToValueAtTime(b.closed, v.start + len);
  lp.connect(v.out);
  tone(v, v.start, 'sawtooth', midiToFreq(midi), 0.004, len, b.sawPeak, lp);
  tone(v, v.start, 'sine', midiToFreq(midi - 12), 0.004, len, b.subPeak);
}

/** 層 layer に、accent の音量でハイハットを 1 つ鳴らす。ノイズの読み出し位置は毎回変える */
export function bgmHat(voice: StepVoice, layer: number, accent: number, h: HatTone): void {
  const v = voice(0.08, accent, layer);
  if (!v) return;
  noise(v, v.start, 'highpass', h.cutoff, DEFAULT_Q, 0.001, h.decay, h.peak, Math.random());
}
