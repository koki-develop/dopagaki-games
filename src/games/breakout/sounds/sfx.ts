import type { AudioEngine, Bus, Voice, VoiceGroup, VoicePriority, VoiceRequest } from '../../../juice/audio/engine.ts';
import { octavePosition, pentatonicSemitones, shepardAnchor, shepardWaves } from '../../../juice/audio/shepard.ts';
import { DEFAULT_Q, envGain, glide, jitterCents, midiToFreq, noise, oscillator, stopTime, tone } from '../../../juice/audio/synth.ts';

/** Shepard tone の一番低い成分の基準周波数（C3） */
const SHEPARD_BASE = 130.81;
const SHEPARD_COMPONENTS = 4;
/** Shepard tone の音程の揺らぎ（セント） */
const SHEPARD_JITTER = 8;
/** 音の出だしの長さ（秒） */
const PLUCK_ATTACK = 0.002;
/** 破壊音の減衰の長さ（秒）。演出の強さが 0 のときと 1 のとき */
const BREAK_DECAY_CALM = 0.3;
const BREAK_DECAY_BUSY = 0.16;
/** 破壊音の低音の塊は、ピークがこれより小さければ鳴らさない */
const BREAK_THUMP_MIN = 0.02;

/** ボール大量ブロックの和音の、ペンタトニックでの構成（step からの距離） */
const MEGA_CHORD = [0, 2, 4] as const;
/** ゲームオーバーの和音（MIDI 番号とデチューンのセント） */
const GAME_OVER_MIDI = [57, 57, 60, 64] as const;
const GAME_OVER_DETUNE = [-8, 8, 0, -5] as const;
/** Peak の和音（Am9 系）。level が上がるほど前から多く使う */
const PEAK_VOICING = [45, 52, 57, 60, 64, 67, 71, 74, 76, 79] as const;
const FINALE_CHORD = [33, 45, 52, 57, 60, 64, 69, 71, 76, 81, 84] as const;
/** フィナーレの最後に解決する和音（C メジャー 9） */
const RESOLVE_CHORD = [36, 48, 55, 59, 62, 64, 67, 72, 76] as const;
/** supersaw の 1 音を 2 本のノコギリ波に分けるデチューン（セント） */
const SUPERSAW_DETUNE = 9;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * ブロック崩しの効果音。どれも Web Audio の標準ノードだけで、その場で合成する。
 * 同じ音でも毎回ピッチと音色をわずかに揺らす。
 *
 * 1 回のプレイごとに作り、鳴らす音はすべて group に属する。プレイを捨てるときは group.stopAll() で残響ごと止める。
 * 聞き逃せない節目の音（ボール 0・着地・ゲームオーバー・Peak・フィナーレ）は event の優先度で鳴らし、
 * 大量に鳴る普段の音に同時発音数の枠を奪われないようにする。
 */
export class BreakoutSfx {
  private readonly e: AudioEngine;
  private readonly req: VoiceRequest;

  constructor(engine: AudioEngine, group: VoiceGroup) {
    this.e = engine;
    this.req = { bus: 'sfx', duration: 0, gain: 1, priority: 'normal', group };
  }

  /** パドルで打つ: 低い打撃音 + クリック */
  paddle(strength: number, gain: number): void {
    const v = this.open(0.22, 0.9 * gain);
    if (!v) return;
    const t = v.start;
    const f = 150 * 2 ** (jitterCents(40) / 1200);
    glide(tone(v, t, 'sine', f * 1.6, 0.002, 0.2, 0.55 + 0.25 * strength).frequency, f * 0.4, t + 0.1);
    glide(tone(v, t, 'triangle', f * 3.1, 0.001, 0.06, 0.1).frequency, f, t + 0.05);
    // 耳に刺さらないよう、クリックは低めの帯域で短く小さく
    noise(v, t, 'bandpass', rand(1800, 2300), 1.2, 0.001, 0.014, 0.16, Math.random());
  }

  /** ハードに当たる: 金属的な音。壊れる直前ほど高く鳴る。count はまとめた回数、gain は間引きによる 1 音の音量 */
  hardHit(hpLeftRatio: number, count: number, gain = 1): void {
    const loud = Math.min(1.6, 1 + Math.log2(count) * 0.25);
    const v = this.open(0.2, 0.55 * loud * gain);
    if (!v) return;
    const t = v.start;
    const f = (700 + (1 - hpLeftRatio) * 700) * 2 ** (jitterCents(30) / 1200);
    tone(v, t, 'square', f, 0.001, 0.09, 0.12);
    tone(v, t, 'sine', f * 2.76, 0.001, 0.16, 0.22);
    tone(v, t, 'sine', f * 5.4, 0.001, 0.07, 0.1);
    noise(v, t, 'bandpass', 4200, 3, 0.001, 0.03, 0.25, Math.random());
  }

  /**
   * ブロックを壊す: ペンタトニックで上がる Shepard tone とクリック。
   * count はこの 1 音にまとめた破壊数で、音量と厚みを log スケールで増やす。gain は間引きによる 1 音の音量。
   * brightness（演出の強さ）が上がるほど音を短く明るくし、低音の塊を減らして、速く続けて鳴っても濁らないようにする。
   */
  breakNote(step: number, count: number, brightness: number, gain: number): void {
    const thick = Math.log2(1 + count);
    const decay = BREAK_DECAY_CALM + (BREAK_DECAY_BUSY - BREAK_DECAY_CALM) * brightness;
    const v = this.open(decay + 0.04, Math.min(1.5, 0.5 + 0.28 * thick) * gain);
    if (!v) return;
    const t = v.start;
    this.shepardPluck(v, t, step, decay, 0.2, brightness);
    noise(v, t, 'bandpass', rand(1800, 2600) + 800 * brightness, 1.2, 0.001, 0.028 + 0.01 * thick, 0.3, Math.random());
    // まとめて壊れたときは、低音の塊を足して重さを出す
    const thump = count >= 3 ? Math.min(0.5, 0.12 * thick) * (1 - brightness) : 0;
    if (thump >= BREAK_THUMP_MIN) glide(tone(v, t, 'sine', 90, 0.002, 0.16, thump).frequency, 45, t + 0.12);
  }

  /** ボール大量ブロック: くす玉が弾けるような和音と破裂音 */
  megaBurst(step: number): void {
    const v = this.open(1.0, 0.9);
    if (!v) return;
    const t = v.start;
    // 和音の 3 音は同じエンベロープなので、1 つにまとめてつなぐ
    const decay = 0.75;
    const env = envGain(v.ctx, t, PLUCK_ATTACK, decay, 0.16, v.out);
    const end = stopTime(t, PLUCK_ATTACK, decay);
    for (let i = 0; i < MEGA_CHORD.length; i++) this.shepardOsc(v, t, step + MEGA_CHORD[i], 0.8, end, env);
    glide(noise(v, t, 'bandpass', 1400, 0.8, 0.005, 0.35, 0.35, Math.random()).frequency, 7000, t + 0.355);
    glide(tone(v, t, 'sine', 120, 0.002, 0.35, 0.6).frequency, 40, t + 0.25);
  }

  /** ボールが 0 個になった: 重い低音 */
  ballsZero(): void {
    const v = this.open(1.3, 1, 'event');
    if (!v) return;
    const t = v.start;
    glide(tone(v, t, 'sine', 72, 0.01, 1.2, 0.9).frequency, 26, t + 1.0);
    glide(tone(v, t, 'triangle', 110, 0.01, 0.7, 0.2).frequency, 40, t + 0.6);
    glide(noise(v, t, 'lowpass', 420, DEFAULT_Q, 0.01, 0.9, 0.5, Math.random()).frequency, 60, t + 0.91);
  }

  /** ペナルティで降りてきたブロックが着地した: 叩きつける音 */
  slam(): void {
    const v = this.open(0.6, 1, 'event');
    if (!v) return;
    const t = v.start;
    glide(noise(v, t, 'lowpass', 1400, DEFAULT_Q, 0.001, 0.45, 0.8, Math.random()).frequency, 110, t + 0.451);
    glide(tone(v, t, 'sine', 62, 0.002, 0.5, 0.9).frequency, 32, t + 0.4);
    noise(v, t, 'highpass', 2500, DEFAULT_Q, 0.001, 0.02, 0.5, Math.random());
  }

  /** エンドレスでブロックが 1 段降りて着地した: 短く重い「ガコン」 */
  stepThud(): void {
    const v = this.open(0.25, 0.55);
    if (!v) return;
    const t = v.start;
    glide(noise(v, t, 'lowpass', 1100, DEFAULT_Q, 0.001, 0.14, 0.6, Math.random()).frequency, 160, t + 0.141);
    glide(tone(v, t, 'sine', 95, 0.002, 0.18, 0.7).frequency, 48, t + 0.12);
    noise(v, t, 'highpass', 3200, DEFAULT_Q, 0.001, 0.012, 0.25, Math.random());
  }

  /** ゲームオーバー: 下がっていく暗い音 */
  gameOver(): void {
    const v = this.open(2.2, 0.8, 'event');
    if (!v) return;
    const ctx = v.ctx;
    const t = v.start;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 2);
    lp.connect(v.out);
    // 4 本のノコギリ波は同じエンベロープなので、1 つにまとめてつなぐ
    const env = envGain(ctx, t, 0.02, 2.0, 0.12, lp);
    const end = stopTime(t, 0.02, 2.0);
    for (let i = 0; i < GAME_OVER_MIDI.length; i++) {
      const midi = GAME_OVER_MIDI[i];
      const o = oscillator(v, t, 'sawtooth', midiToFreq(midi), end, env);
      o.detune.value = GAME_OVER_DETUNE[i];
      glide(o.frequency, midiToFreq(midi - 12), t + 1.8);
    }
    glide(tone(v, t, 'sine', 55, 0.02, 2.0, 0.6).frequency, 30, t + 1.8);
  }

  /**
   * Peak の和音。level が上がるほど、音域を広げて音を厚くする。
   * 和音は Am9 系で、BGM の調と合わせる。
   */
  peakChord(level: number): void {
    const dur = 1.6 + level * 0.3;
    const v = this.open(dur + 0.2, 0.75, 'event');
    if (!v) return;
    const t = v.start;
    const count = Math.min(PEAK_VOICING.length, 5 + level * 2);
    this.supersaw(v, t, PEAK_VOICING, count, dur, 0.08, 1400 + level * 900);
    glide(noise(v, t, 'bandpass', 600, 0.6, 0.25, 0.8, 0.25, Math.random()).frequency, 9000, t + 1.05);
    glide(tone(v, t, 'sine', 110, 0.002, 0.6, 0.7).frequency, 42, t + 0.5);
  }

  /**
   * 溜めの吸い込み音。逆再生のように duration 秒かけて音量と音程が上がり、炸裂の瞬間に途切れる。
   * 他の音は消えている間に鳴らすので、無音を通らない lead の経路で鳴らす。
   */
  inhale(duration: number): void {
    const v = this.open(duration + 0.02, 0.9, 'event', 'lead');
    if (!v) return;
    const ctx = v.ctx;
    const t = v.start;
    const end = t + duration;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, end - 0.01);
    g.gain.linearRampToValueAtTime(0.0001, end);
    g.connect(v.out);
    const src = ctx.createBufferSource();
    src.buffer = v.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(7000, end);
    src.connect(bp).connect(g);
    src.start(t, Math.random() * 0.5);
    src.stop(end);
    v.track(src);
    const og = ctx.createGain();
    og.gain.value = 0.35;
    og.connect(g);
    const o = oscillator(v, t, 'sine', 180, end, og);
    o.frequency.exponentialRampToValueAtTime(1400, end);
  }

  /** ステージクリアの炸裂: 音域全体に広がる和音と破裂音 */
  finaleBurst(): void {
    const v = this.open(3.2, 0.85, 'event');
    if (!v) return;
    const t = v.start;
    this.supersaw(v, t, FINALE_CHORD, FINALE_CHORD.length, 2.8, 0.004, 6000);
    glide(noise(v, t, 'highpass', 900, DEFAULT_Q, 0.002, 2.2, 0.45, Math.random()).frequency, 300, t + 2.202);
    glide(noise(v, t, 'lowpass', 2000, DEFAULT_Q, 0.001, 0.9, 0.8, Math.random()).frequency, 80, t + 0.901);
    glide(tone(v, t, 'sine', 90, 0.002, 1.4, 1).frequency, 28, t + 1.2);
  }

  /** フィナーレで、光がスコアへ届いたときの 1 音。高い音域で明るく弾ける */
  bonusNote(step: number, gain: number): void {
    const v = this.open(0.35, gain);
    if (!v) return;
    const t = v.start;
    this.shepardPluck(v, t, step, 0.3, 0.12, 1);
    tone(v, t, 'sine', midiToFreq(84 + pentatonicSemitones(step % 5)), 0.002, 0.25, 0.12);
  }

  /** フィナーレの最後に解決する和音（C メジャー 9） */
  resolveChord(): void {
    const v = this.open(3.6, 0.7, 'event');
    if (!v) return;
    const t = v.start;
    this.supersaw(v, t, RESOLVE_CHORD, RESOLVE_CHORD.length, 3.3, 0.05, 3200);
    tone(v, t, 'sine', 65.41, 0.02, 3.2, 0.6);
  }

  private open(duration: number, gain: number, priority: VoicePriority = 'normal', bus: Bus = 'sfx'): Voice | null {
    const r = this.req;
    r.bus = bus;
    r.duration = duration;
    r.gain = gain;
    r.priority = priority;
    return this.e.voice(r);
  }

  /** Shepard tone の 1 音をエンベロープ付きで鳴らす */
  private shepardPluck(v: Voice, t: number, step: number, decay: number, peak: number, brightness: number): void {
    const env = envGain(v.ctx, t, PLUCK_ATTACK, decay, peak, v.out);
    this.shepardOsc(v, t, step, brightness, stopTime(t, PLUCK_ATTACK, decay), env);
  }

  /**
   * Shepard tone の全成分を、作り置きの PeriodicWave を使う OscillatorNode 1 つで鳴らす。
   * 揺らぎは、最も近い半音の波形からのずれとして detune で足す。
   */
  private shepardOsc(v: Voice, t: number, step: number, brightness: number, stopAt: number, dest: AudioNode): void {
    const semis = pentatonicSemitones(step) + jitterCents(SHEPARD_JITTER) / 100;
    const anchor = shepardAnchor(semis);
    const wave = shepardWaves(v.ctx, SHEPARD_COMPONENTS).wave(anchor, brightness > 0.6 ? 'triangle' : 'sine');
    const o = oscillator(v, t, wave, SHEPARD_BASE * 2 ** (anchor / 12), stopAt, dest);
    o.detune.value = (octavePosition(semis) - anchor) * 100;
  }

  /**
   * デチューンしたノコギリ波を重ねて、ローパスで削る。midis の先頭 count 音を使う。
   * どのノコギリ波も同じエンベロープなので、1 つにまとめてからローパスへつなぐ。
   */
  private supersaw(v: Voice, t: number, midis: readonly number[], count: number, dur: number, attack: number, cutoff: number): void {
    const ctx = v.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(cutoff * 0.4, t);
    lp.frequency.exponentialRampToValueAtTime(cutoff, t + Math.max(0.02, attack * 4));
    lp.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.25), t + dur);
    lp.connect(v.out);
    const env = envGain(ctx, t, attack, dur, 0.34 / Math.sqrt(count * 2), lp);
    const end = stopTime(t, attack, dur);
    for (let i = 0; i < count; i++) {
      const f = midiToFreq(midis[i]);
      oscillator(v, t, 'sawtooth', f, end, env).detune.value = -SUPERSAW_DETUNE + jitterCents(3);
      oscillator(v, t, 'sawtooth', f, end, env).detune.value = SUPERSAW_DETUNE + jitterCents(3);
    }
  }
}
