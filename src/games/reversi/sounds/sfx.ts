import { NO_SOUND, voiceHandle } from '../../../juice/audio/engine.ts';
import type { AudioEngine, Bus, SoundHandle, Voice, VoiceGroup, VoicePriority } from '../../../juice/audio/engine.ts';
import { pentatonicSemitones } from '../../../juice/audio/shepard.ts';
import { DEFAULT_Q, drive, envGain, glide, jitterCents, midiToFreq, noise, oscillator, riserInhale, send, shepardPluck, stopTime, supersaw, tone } from '../../../juice/audio/synth.ts';
import type { InhaleShape } from '../../../juice/audio/synth.ts';
import { VoiceOpener } from '../../../juice/audio/voices.ts';
import type { Side } from '../types.ts';

/** 短調（エオリアン）の音階。CPU の手の下がっていく音に使う */
const MINOR = [0, 2, 3, 5, 7, 8, 10] as const;

/** 音階の step 番目の音の、基準音からの半音数（負へ無限に下がる） */
function minorSemitonesDown(step: number): number {
  const n = MINOR.length;
  const octave = Math.floor(step / n);
  const degree = step % n;
  return -(octave * 12 + (degree === 0 ? 0 : 12 - MINOR[n - degree]));
}

/** 勝ったときの和音（E メジャー 9） */
const WIN_CHORD = [40, 52, 59, 63, 66, 68, 71, 75, 78] as const;
/** パーフェクトのときに上に重ねる音 */
const PERFECT_TOP = [80, 83, 87, 90] as const;
/** 負けたときの和音（E マイナー。低く短い） */
const LOSE_MIDI = [40, 47, 52, 55] as const;
/** 引き分けの和音（E sus4） */
const DRAW_CHORD = [40, 47, 52, 57, 59, 64] as const;
/** 角を取ったときの和音（E メジャー。明るく短く叩く） */
const CORNER_CHORD = [52, 59, 64, 68, 71, 76] as const;
/** 自己ベストの和音（E メジャー。上へ広げる） */
const NEW_BEST_CHORD = [52, 59, 64, 68, 71, 76, 80, 83] as const;
/** CPU の大きな手の不穏な和音（短 2 度を含む） */
const DREAD_MIDI = [28, 35, 40, 41] as const;
/** 溜めの吸い込む音の音色 */
const INHALE: InhaleShape = { noiseFrom: 300, noiseTo: 6500, toneFrom: 160, toneTo: 1300, toneLevel: 0.3 };
/** 確定石の結晶の音の高さの候補（基準の音からの半音） */
const STABLE_STEPS = [0, 3, 7] as const;
/** 金属の打撃の倍音（整数比にならない比で、鐘や金床らしくする） */
const METAL_PARTIALS = [1, 2.76, 5.4, 8.93] as const;

const rand = (a: number, b: number) => a + Math.random() * (b - a);


/**
 * リバーシの効果音。どれも Web Audio の標準ノードだけで、その場で合成する。同じ音でも毎回ピッチと音色をわずかに揺らす。
 *
 * 物量で押せないゲームなので、1 発ごとに層を重ねる。人の石が着く音は、破裂音・硬い打撃・歪ませた胴鳴り・下がる重低音・残響を重ね、
 * 段階が上がるほど金属の打撃と爆発の尾を足す。
 *
 * 人の手は明るく上がっていく音、CPU の手は重く下がっていく音にする。CPU に石を返されるのは人にとっての損なので、
 * 祝福に聞こえる音（上がっていく音、明るい和音）を付けない。
 *
 * 1 回のプレイごとに作り、鳴らす音はすべて group に属する。プレイを捨てるときは group.stopAll() で残響ごと止める。
 * 聞き逃せない節目の音（着地の打撃・角・パス・大きな手・得点・コンボ・最高スコアの更新・勝敗）は event の優先度で鳴らす。
 */
export class ReversiSfx {
  private readonly voices: VoiceOpener;

  constructor(engine: AudioEngine, group: VoiceGroup) {
    this.voices = new VoiceOpener(engine, group);
  }

  /** 人の石が落ちてくる間の「ヒュッ」。duration 秒かけて上がり、着く瞬間に消える */
  swoosh(duration: number, tier: number): void {
    const v = this.open(duration + 0.02, 0.55 + 0.1 * tier);
    if (!v) return;
    const t = v.start;
    glide(noise(v, t, 'bandpass', 900, 1.6, duration - 0.005, 0.005, 0.9, Math.random()).frequency, 5200 + 900 * tier, t + duration);
  }

  /**
   * 終局の儀式の始まりに、全部の石が跳ねる音。rising なら duration 秒かけて上がる「ヒュッ」（勝ち）、
   * そうでなければ上がらずに低く抜ける息の音（負けと引き分け）
   */
  gatherLift(duration: number, rising: boolean): void {
    if (rising) {
      this.swoosh(duration, 3);
      return;
    }
    const v = this.open(duration + 0.25, 0.45);
    if (!v) return;
    const t = v.start;
    glide(noise(v, t, 'bandpass', 700, 1.1, duration * 0.4, duration * 0.6 + 0.2, 0.5, Math.random()).frequency, 420, t + duration + 0.2);
  }

  /**
   * 石が盤に着いた。人の手は tier（0〜4）で層を足し、CPU の手は tier を重さ（返した枚数の段階）として使う。
   * 人: 破裂音 + 硬い打撃 + 歪ませた胴鳴り + 下がる重低音 + 残響。段階 1 から金属の打撃、段階 3 から爆発の尾
   */
  place(side: Side, tier: number): void {
    if (side === 'cpu') {
      this.cpuPlace(Math.min(1, tier / 3));
      return;
    }
    const v = this.open(1.6 + 0.4 * tier, 1, 'event');
    if (!v) return;
    const t = v.start;
    // 破裂音: ごく短い高域のノイズ
    noise(v, t, 'highpass', 2600, DEFAULT_Q, 0.0005, 0.04 + 0.01 * tier, 0.95, Math.random());
    // 硬い打撃: 石が盤を叩く乾いた音
    glide(tone(v, t, 'triangle', 1900 * 2 ** (jitterCents(40) / 1200), 0.0005, 0.03, 0.45).frequency, 700, t + 0.03);
    noise(v, t, 'bandpass', rand(3000, 3600), 2.4, 0.0005, 0.05, 0.6, Math.random());
    // 胴鳴り: 歪ませて太くし、前へ出す
    const body = drive(v, 2.2 + 0.6 * tier);
    glide(tone(v, t, 'sine', 210, 0.001, 0.16 + 0.03 * tier, 0.55, body).frequency, 52, t + 0.14);
    // 重低音: 下がりながら長く残る
    glide(tone(v, t, 'sine', 90, 0.002, 0.35 + 0.15 * tier, 0.55 + 0.1 * tier).frequency, 30, t + 0.4 + 0.1 * tier);
    if (tier >= 1) this.metal(v, t, 900 + 180 * tier, 0.25 + 0.12 * tier, 0.14 + 0.03 * tier);
    if (tier >= 3) {
      // 爆発の尾: こもったノイズが長く引く
      glide(noise(v, t, 'lowpass', 2400, 0.9, 0.003, 1.1 + 0.3 * (tier - 3), 0.55, Math.random()).frequency, 120, t + 1.2);
    }
    send(v, 0.22 + 0.08 * tier);
  }

  /**
   * 同じ時刻に返りきった石のまとまり。index は手の中で何番目のまとまりか、count はまとめた石の数。
   * 人の手は「パチン」と鋭く、Shepard tone で上がり続け、段階（tier）が高いほど明るい。CPU の手は短調で下がり続ける
   */
  flipStep(side: Side, index: number, count: number, tier: number): void {
    const thick = Math.log2(1 + count);
    if (side === 'human') {
      const v = this.open(0.5, Math.min(1.5, 0.75 + 0.25 * thick));
      if (!v) return;
      const t = v.start;
      const brightness = Math.min(1, 0.45 + tier * 0.15);
      // 「パチン」: 鋭いノイズと、短く跳ねる打撃
      noise(v, t, 'bandpass', rand(3800, 4600) + 300 * tier, 1.8, 0.0005, 0.025, 0.85, Math.random());
      glide(tone(v, t, 'square', 1400, 0.0005, 0.018, 0.12).frequency, 600, t + 0.018);
      shepardPluck(v, t, pentatonicSemitones(index + tier), 0.28 - 0.02 * tier, 0.3, brightness);
      if (count >= 2) tone(v, t, 'sine', midiToFreq(76 + pentatonicSemitones(index % 5)), 0.002, 0.14, 0.07 * thick);
      send(v, 0.08 + 0.03 * tier);
      return;
    }
    const v = this.open(0.5, Math.min(1.2, 0.5 + 0.2 * thick));
    if (!v) return;
    const t = v.start;
    const lp = v.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(v.out);
    shepardPluck(v, t, minorSemitonesDown(index), 0.32, 0.22, 0.2, lp);
    noise(v, t, 'bandpass', rand(900, 1200), 1.1, 0.002, 0.05, 0.3, Math.random());
  }

  /**
   * 大きな手（段階 2 以上）の、返り始める瞬間の歪ませた低音とシンバルのような響き。段階が上がるほど長く、段階 3 からは風の音を足す
   */
  burst(tier: number): void {
    const v = this.open(2.6, 0.85, 'event');
    if (!v) return;
    const t = v.start;
    glide(tone(v, t, 'sine', 110, 0.002, 0.6 + tier * 0.15, 0.9, drive(v, 1.8)).frequency, 30, t + 0.5);
    glide(noise(v, t, 'highpass', 5200, DEFAULT_Q, 0.002, 1.1 + 0.2 * tier, 0.32, Math.random()).frequency, 2600, t + 1.2);
    if (tier >= 3) glide(noise(v, t, 'bandpass', 700, 0.7, 0.002, 1.2, 0.4, Math.random()).frequency, 9000, t + 1.0);
    send(v, 0.4);
  }

  /**
   * 溜め（大きな手の返り始める前と、終局の決着の前）。duration 秒かけて上がり、終わりの瞬間に途切れる。
   * ほかの音を消した無音の中で鳴らすので、lead の経路で鳴らす。途中で止めるときは、返した口の stop を呼ぶ
   */
  inhale(duration: number): SoundHandle {
    const v = this.open(duration + 0.02, 0.8, 'event', 'lead');
    if (!v) return NO_SOUND;
    riserInhale(v, v.start, duration, INHALE);
    return voiceHandle(v);
  }

  /** CPU の大きな手（返した石が多い）: 不穏な低い和音 */
  dread(weight: number): void {
    const v = this.open(1.8, 0.55 + 0.35 * weight, 'event');
    if (!v) return;
    const ctx = v.ctx;
    const t = v.start;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 1.6);
    lp.connect(v.out);
    const env = envGain(ctx, t, 0.01, 1.6, 0.14, lp);
    const end = stopTime(t, 0.01, 1.6);
    for (const m of DREAD_MIDI) oscillator(v, t, 'sawtooth', midiToFreq(m), end, env).detune.value = jitterCents(12);
  }

  /**
   * 人が角を取った: 駆け上がる「キュイン」、明るい長三和音の一撃、歪ませて下がる重低音、シンバル。
   * 長く響かせず、短く鋭く決める
   */
  corner(): void {
    const v = this.open(1.4, 0.9, 'event');
    if (!v) return;
    const ctx = v.ctx;
    const t = v.start;
    // 駆け上がる音: ノコギリ波をバンドパスで細くして、一気に上げる
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(5200, t + 0.14);
    bp.connect(v.out);
    glide(tone(v, t, 'sawtooth', 440, 0.002, 0.22, 0.5, bp).frequency, 1760, t + 0.14);
    // 明るい長三和音の一撃
    supersaw(v, t + 0.03, CORNER_CHORD, CORNER_CHORD.length, 0.7, 0.002, 7000);
    // 重低音
    glide(tone(v, t, 'sine', 130, 0.001, 0.5, 0.85, drive(v, 2.6)).frequency, 36, t + 0.35);
    // シンバル
    glide(noise(v, t, 'highpass', 6000, DEFAULT_Q, 0.001, 0.7, 0.35, Math.random()).frequency, 3500, t + 0.7);
    send(v, 0.2);
  }

  /** 人の石が確定石になった: 結晶の高い音。count はまとめた数 */
  stable(count: number): void {
    const v = this.open(1.0, Math.min(0.9, 0.35 + 0.12 * Math.log2(1 + count)));
    if (!v) return;
    const t = v.start;
    const base = midiToFreq(88 + STABLE_STEPS[Math.floor(Math.random() * STABLE_STEPS.length)]);
    tone(v, t, 'sine', base, 0.002, 0.8, 0.12);
    tone(v, t, 'sine', base * 1.5, 0.002, 0.55, 0.07);
    tone(v, t + 0.06, 'sine', base * 2, 0.002, 0.45, 0.05);
    send(v, 0.2);
  }

  /** コンボが積まれた（count はこの手を含めたコンボ）。コンボが続くほど高く、明るく、厚くなる */
  combo(count: number): void {
    const heat = Math.min(1, count / 20);
    const v = this.open(0.6, 0.45 + 0.35 * heat, 'event');
    if (!v) return;
    const t = v.start;
    shepardPluck(v, t, pentatonicSemitones(count + 4), 0.3, 0.26, 0.5 + 0.5 * heat);
    tone(v, t + 0.035, 'square', midiToFreq(84 + pentatonicSemitones(count % 5)), 0.001, 0.08, 0.06 + 0.06 * heat);
    send(v, 0.15);
  }

  /** コンボが途切れた: 下がって消える、こもった音 */
  comboBreak(): void {
    const v = this.open(0.7, 0.55);
    if (!v) return;
    const t = v.start;
    const lp = v.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.55);
    lp.connect(v.out);
    glide(tone(v, t, 'sawtooth', 520, 0.004, 0.55, 0.22, lp).frequency, 130, t + 0.5);
    noise(v, t, 'bandpass', 900, 1.2, 0.002, 0.2, 0.2, Math.random());
  }

  /** 人の手の得点が入った: 「チャリーン」。倍率が高いほど高く、長く、厚くする */
  score(multiplier: number, quick: boolean): void {
    const lift = Math.min(1, (multiplier - 1) / 2);
    const v = this.open(1.2, 0.6 + 0.25 * lift, 'event');
    if (!v) return;
    const t = v.start;
    const base = midiToFreq(83 + Math.round(lift * 7));
    tone(v, t, 'square', base, 0.001, 0.07, 0.1);
    tone(v, t + 0.07, 'square', base * 4 / 3, 0.001, 0.5 + 0.4 * lift, 0.12);
    tone(v, t + 0.07, 'sine', base * 8 / 3, 0.002, 0.6 + 0.4 * lift, 0.08);
    noise(v, t + 0.07, 'highpass', 7000, DEFAULT_Q, 0.002, 0.35, 0.12 + 0.1 * lift, Math.random());
    // 早打ち: 頭に短く駆け上がる 2 音を足す
    if (quick) {
      tone(v, t, 'square', base * 2, 0.001, 0.05, 0.08);
      tone(v, t + 0.035, 'square', base * 3, 0.001, 0.12, 0.08);
    }
    send(v, 0.25);
  }

  /** 自己ベストのスコアを超えた: 駆け上がる和音 */
  newBest(): void {
    const v = this.open(2.8, 0.85, 'event');
    if (!v) return;
    const t = v.start;
    for (let i = 0; i < 4; i++) {
      tone(v, t + i * 0.07, 'square', midiToFreq(NEW_BEST_CHORD[2 + i]), 0.002, 0.25, 0.1);
    }
    supersaw(v, t + 0.28, NEW_BEST_CHORD, NEW_BEST_CHORD.length, 2.2, 0.01, 6500);
    glide(tone(v, t + 0.28, 'sine', 82.4, 0.002, 1.2, 0.7, drive(v, 2)).frequency, 41.2, t + 1.2);
    send(v, 0.45);
  }

  /** パスした。人のパスは落胆の下がる音、CPU のパスは軽く弾む音 */
  pass(who: Side): void {
    const v = this.open(0.9, 0.7, 'event');
    if (!v) return;
    const t = v.start;
    if (who === 'human') {
      const lp = v.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      lp.connect(v.out);
      glide(tone(v, t, 'sawtooth', 220, 0.01, 0.7, 0.25, lp).frequency, 98, t + 0.6);
      return;
    }
    glide(tone(v, t, 'triangle', 440, 0.004, 0.25, 0.3).frequency, 880, t + 0.12);
    tone(v, t + 0.12, 'triangle', 1320, 0.004, 0.2, 0.2);
  }

  /** 打てないマスを選んだ: 短く鈍い音 */
  nope(): void {
    const v = this.open(0.16, 0.45);
    if (!v) return;
    const t = v.start;
    const lp = v.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(v.out);
    tone(v, t, 'square', 150, 0.002, 0.09, 0.12, lp);
    tone(v, t + 0.05, 'square', 120, 0.002, 0.08, 0.1, lp);
  }

  /**
   * 対局の始まりに、始める局面の石が落ちた。index は何枚目か。
   * 石が多い局面でも音域を外れないよう、Shepard tone で上がり続けて聞こえるようにする
   */
  introDrop(index: number): void {
    const v = this.open(0.4, 0.75);
    if (!v) return;
    const t = v.start;
    noise(v, t, 'bandpass', rand(2600, 3200), 2, 0.001, 0.03, 0.6, Math.random());
    glide(tone(v, t, 'sine', 160, 0.001, 0.12, 0.4, drive(v, 1.6)).frequency, 60, t + 0.1);
    shepardPluck(v, t, pentatonicSemitones(index), 0.2, 0.18, 0.5);
    send(v, 0.15);
  }

  /** 終局の並べ直しで、1 組の石が元の位置で消えた: 下がって消える短い「プシュン」。現れた瞬間は数える音（countTick）が鳴る */
  vanish(): void {
    const v = this.open(0.12, 0.5);
    if (!v) return;
    const t = v.start;
    glide(noise(v, t, 'highpass', 7000, DEFAULT_Q, 0.001, 0.06, 0.5, Math.random()).frequency, 1800, t + 0.06);
  }

  /** 対局の始まりの盤が現れる音 */
  boardIn(): void {
    const v = this.open(1.0, 0.7);
    if (!v) return;
    const t = v.start;
    glide(noise(v, t, 'bandpass', 400, 0.8, 0.02, 0.5, 0.35, Math.random()).frequency, 3000, t + 0.45);
    glide(tone(v, t, 'sine', 60, 0.01, 0.5, 0.5).frequency, 110, t + 0.4);
    send(v, 0.3);
  }

  /**
   * 終局で石を数えた。index は数えた順番、alone はもう片方の側を数え終えてからの 1 枚か。
   * 人の石は、rising（勝ち）なら上がっていき、そうでなければ同じ高さのまま。CPU の石は下がっていく
   */
  countTick(side: Side, index: number, alone: boolean, rising: boolean): void {
    const v = this.open(0.3, alone ? 0.55 : 0.4);
    if (!v) return;
    const t = v.start;
    if (side === 'cpu') shepardPluck(v, t, minorSemitonesDown(index), 0.22, 0.18, 0.2);
    else if (rising) shepardPluck(v, t, pentatonicSemitones(index), 0.22, 0.2, alone ? 0.9 : 0.4);
    else tone(v, t, 'triangle', midiToFreq(64), 0.002, 0.16, 0.14);
    noise(v, t, 'highpass', 3800, DEFAULT_Q, 0.001, 0.015, 0.25, Math.random());
  }

  /** 勝敗の和音。勝ちは明るく長く、パーフェクトはさらに高く。負けは低く短く、引き分けは宙に浮いた和音 */
  verdict(outcome: 'win' | 'lose' | 'draw', perfect: boolean): void {
    if (outcome === 'win') {
      const v = this.open(perfect ? 5 : 4, 0.85, 'event');
      if (!v) return;
      const t = v.start;
      supersaw(v, t, WIN_CHORD, WIN_CHORD.length, perfect ? 4.2 : 3.4, 0.02, perfect ? 6500 : 4200);
      if (perfect) supersaw(v, t + 0.12, PERFECT_TOP, PERFECT_TOP.length, 3.8, 0.05, 8000);
      glide(tone(v, t, 'sine', 82.4, 0.01, 2.6, 0.8, drive(v, 2)).frequency, 41.2, t + 2.2);
      glide(noise(v, t, 'highpass', 900, DEFAULT_Q, 0.002, 2.4, 0.4, Math.random()).frequency, 300, t + 2.4);
      send(v, 0.45);
      return;
    }
    if (outcome === 'draw') {
      const v = this.open(3, 0.7, 'event');
      if (!v) return;
      supersaw(v, v.start, DRAW_CHORD, DRAW_CHORD.length, 2.4, 0.08, 2600);
      send(v, 0.3);
      return;
    }
    const v = this.open(2.4, 0.7, 'event');
    if (!v) return;
    const ctx = v.ctx;
    const t = v.start;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1600, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 2);
    lp.connect(v.out);
    const env = envGain(ctx, t, 0.02, 2.0, 0.12, lp);
    const end = stopTime(t, 0.02, 2.0);
    for (const m of LOSE_MIDI) {
      const o = oscillator(v, t, 'sawtooth', midiToFreq(m), end, env);
      o.detune.value = jitterCents(8);
      glide(o.frequency, midiToFreq(m - 5), t + 1.8);
    }
  }

  /** CPU の石が着いた。高いところから落ちた重い石: こもった打撃と、歪ませた長い低音。weight（0〜1）で重くする */
  private cpuPlace(weight: number): void {
    const v = this.open(0.9, 1);
    if (!v) return;
    const t = v.start;
    glide(noise(v, t, 'lowpass', 1100, DEFAULT_Q, 0.002, 0.18, 0.8, Math.random()).frequency, 150, t + 0.18);
    glide(tone(v, t, 'sine', 95, 0.003, 0.5, 0.8, drive(v, 1.6 + weight)).frequency, 32, t + 0.45);
    tone(v, t, 'triangle', 420 * 2 ** (jitterCents(30) / 1200), 0.001, 0.04, 0.18);
    noise(v, t, 'bandpass', rand(600, 800), 1.4, 0.004, 0.35, 0.25 * (0.5 + weight), Math.random());
  }

  /** 金属の打撃: 整数比にならない倍音を重ねる。f は一番低い倍音、decay は一番低い倍音の長さ */
  private metal(v: Voice, t: number, f: number, decay: number, peak: number): void {
    METAL_PARTIALS.forEach((ratio, i) => tone(v, t, 'sine', f * ratio, 0.0005, decay / (1 + i * 0.8), peak / (1 + i * 0.6)));
  }

  private open(duration: number, gain: number, priority: VoicePriority = 'normal', bus: Bus = 'sfx'): Voice | null {
    return this.voices.open(duration, gain, priority, bus);
  }
}
