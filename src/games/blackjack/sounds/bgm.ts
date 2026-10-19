import { LayeredBgm } from '../../../juice/audio/bgm.ts';
import type { Arrangement, StepVoice } from '../../../juice/audio/bgm.ts';
import type { AudioEngine, Voice } from '../../../juice/audio/engine.ts';
import { pluckBuffer } from '../../../juice/audio/pluck.ts';
import type { PluckString } from '../../../juice/audio/pluck.ts';
import type { IntervalTimer } from '../../../juice/audio/sequencer.ts';
import { glide, midiToFreq, noise, oscillator, tone } from '../../../juice/audio/synth.ts';

/** テンポと刻み（16 分音符。ボサノヴァはスウィングさせず、16 分の裏をわずかに遅らせて揺らす） */
const BGM_BPM = 132;
const STEPS_PER_BEAT = 4;
const STEPS_PER_BAR = STEPS_PER_BEAT * 4;
const STEP_SECONDS = 60 / BGM_BPM / STEPS_PER_BEAT;
/** 16 分の裏を遅らせる量（秒） */
const LILT = 0.012;

/** 和音 1 つ: ベースの根音（MIDI 36〜47）と、ローズの押さえ方（低い音から） */
type Chord = { readonly root: number; readonly voicing: readonly number[] };
/** 旋律の 1 音: 小節の中の位置、MIDI 番号、長さ（刻み） */
type Note = readonly [step: number, midi: number, steps: number];
/** 1 小節: 和音（2 つなら 2 つ目は 3 拍目から）と、旋律 */
type Bar = { readonly chords: readonly Chord[]; readonly melody: readonly Note[] };

const ch = (root: number, ...voicing: number[]): Chord => ({ root, voicing });

// 和音（根音を抜いて 3 度・7 度・テンションを中心に、隣の和音へ指が近く動く押さえ方）
const Gm9 = ch(43, 53, 58, 62, 69);
const C13 = ch(36, 52, 58, 62, 69);
const Fmaj9 = ch(41, 52, 57, 60, 67);
const D7b9 = ch(38, 54, 60, 63, 69);
const Am7 = ch(45, 55, 60, 64, 69);
const Gm7 = ch(43, 53, 58, 62, 67);
const C7b9 = ch(36, 52, 58, 61, 67);
const Fm9 = ch(41, 51, 56, 60, 67);
const Bb13 = ch(46, 50, 56, 60, 67);
const Ebmaj9 = ch(39, 50, 55, 58, 65);
const Ebm9 = ch(39, 49, 54, 58, 65);
const Ab13 = ch(44, 48, 54, 58, 65);
const Dbmaj9 = ch(37, 48, 53, 56, 63);

/**
 * 16 小節で 1 周する、ヘ長調のジャズ・ボサノヴァ。前半は ii-V-I を 2 回、後半は Fm9-B♭13 から E♭、D♭ へ下りて ii-V へ戻る。
 * 旋律は長い音を中心に、和音のテンション（9 度・13 度・♭9 度）へ寄せる
 */
const BARS: readonly Bar[] = [
  { chords: [Gm9], melody: [[4, 74, 2], [6, 72, 2], [8, 69, 8]] },
  { chords: [C13], melody: [[0, 70, 4], [4, 69, 4], [8, 67, 8]] },
  { chords: [Fmaj9], melody: [[2, 69, 2], [4, 72, 2], [6, 76, 10]] },
  { chords: [Fmaj9, D7b9], melody: [[8, 75, 4], [12, 74, 4]] },
  { chords: [Gm9], melody: [[2, 70, 2], [4, 74, 2], [6, 77, 6], [12, 74, 4]] },
  { chords: [C13], melody: [[0, 76, 6], [6, 74, 2], [8, 72, 4], [12, 69, 4]] },
  { chords: [Am7, D7b9], melody: [[0, 72, 6], [8, 66, 4], [12, 69, 4]] },
  { chords: [Gm7, C7b9], melody: [[0, 70, 8], [8, 73, 4], [12, 72, 4]] },
  { chords: [Fmaj9], melody: [[0, 69, 12], [14, 67, 2]] },
  { chords: [Fm9, Bb13], melody: [[0, 68, 6], [6, 67, 2], [8, 67, 6], [14, 70, 2]] },
  { chords: [Ebmaj9], melody: [[0, 74, 8], [8, 77, 4], [12, 79, 4]] },
  { chords: [Ebm9, Ab13], melody: [[0, 78, 6], [6, 77, 2], [8, 77, 6], [14, 75, 2]] },
  { chords: [Dbmaj9], melody: [[0, 72, 10], [12, 75, 4]] },
  { chords: [Gm9, C13], melody: [[0, 74, 6], [8, 76, 4], [12, 74, 4]] },
  { chords: [Fmaj9], melody: [[0, 72, 8]] },
  { chords: [Am7, D7b9], melody: [[8, 69, 2], [10, 72, 2], [12, 75, 4]] },
];

/** 層 */
const BASS = 0;
const DRUMS = 1;
const KEYS = 2;

/**
 * ベースとバスドラム: 「1、2 拍目の裏、3、4 拍目の裏」。和音が 1 つの小節は根音・根音・5 度・5 度、
 * 2 つの小節は根音・根音・次の根音・その 5 度
 */
const BASS_STEPS: readonly number[] = [0, 6, 8, 14];
const BASS_LENGTHS: readonly number[] = [6, 2, 6, 2];
const KICK_LEVELS: readonly number[] = [1, 0.45, 0.8, 0.45];
/** クロススティック（リムを叩く「コッ」）: 2 小節で 1 周するボサノヴァのクラーベ */
const RIM: readonly (readonly number[])[] = [
  [0, 6, 12],
  [4, 10],
];

/**
 * 楽器ごとの音量の倍率。ボサノヴァのコンボの釣り合い（ベースを土台に、旋律をその少し下、和音とドラムはさらに下）に合わせる。
 * 値は、楽器ごとに書き出した音の大きさ（RMS）を測ってそろえてある
 */
const MIX = { bass: 0.62, drums: 1.1, keys: 0.67 } as const;
/** 曲全体の音量（層の音量）。効果音の後ろで、さりげなく流れる大きさにする */
const LEVEL = 0.4;

/** ウッドベースの弦: 指の腹で柔らかくはじき、長く伸びる */
const UPRIGHT: PluckString = { name: 'upright', t60: 2.4, brightness: 0.22, pickPosition: 0.13, seconds: 1.6 };

/** 和音が 2 つの小節は 3 拍目から 2 つ目 */
const chordAt = (bar: Bar, inBar: number): Chord => bar.chords[bar.chords.length > 1 && inBar >= 8 ? 1 : 0];
/** 根音の 5 度（ベースの音域に収まるよう、上か下か） */
const fifthOf = (root: number): number => (root + 7 <= 50 ? root + 7 : root - 5);
/** 16 分の裏なら少し遅らせる */
const liltOf = (inBar: number): number => (inBar % 2 === 1 ? LILT : 0);

/**
 * ブラックジャックの BGM の中身。夜のカジノのラウンジで流れるような、ジャズ・ボサノヴァのコンボを生の楽器に似せて鳴らす。
 * ウッドベース、ブラシとクロススティックとバスドラム、エレクトリックピアノ（フェンダー・ローズ）。
 * ローズは和音を変わり目ごとに柔らかく長く鳴らし、16 小節を 2 周で 1 組にした 1 周目だけ、その上で旋律を弾く。
 * 段階によって層を出し入れせず、プレイの間ずっと同じ編成・同じ音量で鳴らす
 */
export const BLACKJACK_ARRANGEMENT: Arrangement = {
  bpm: BGM_BPM,
  stepsPerBeat: STEPS_PER_BEAT,
  layerCount: 3,
  layerLevel: () => LEVEL,
  layerTau: () => 1,
  room: { seconds: 1.9, level: 0.32, sends: [0.05, 0.2, 0.45] },
  play: (step, _time, _tier, voice) => {
    const inBar = step % STEPS_PER_BAR;
    const barNo = Math.floor(step / STEPS_PER_BAR);
    const barIndex = barNo % BARS.length;
    const bar = BARS[barIndex];

    const beat = BASS_STEPS.indexOf(inBar);
    if (beat >= 0) {
      const c = chordAt(bar, inBar);
      const fifth = bar.chords.length > 1 ? beat === 3 : beat >= 2;
      uprightBass(voice, fifth ? fifthOf(c.root) : c.root, BASS_LENGTHS[beat] * STEP_SECONDS, beat % 2 === 0 ? 1 : 0.8, liltOf(inBar));
      kick(voice, KICK_LEVELS[beat]);
    }
    shaker(voice, inBar % 4 === 2 ? 1 : inBar % 2 === 0 ? 0.6 : 0.32, liltOf(inBar));
    if (RIM[barIndex % 2].includes(inBar)) crossStick(voice);
    if (inBar === 4 || inBar === 12) hatChick(voice);

    if (inBar === 0 || (inBar === 8 && bar.chords.length > 1)) {
      rhodesNote(voice, chordAt(bar, inBar).voicing, (bar.chords.length > 1 ? 8 : 16) * STEP_SECONDS, 0.6, 0.08 * MIX.keys);
    }
    if (Math.floor(barNo / BARS.length) % 2 === 0) {
      for (const [s, midi, len] of bar.melody) if (s === inBar) rhodesNote(voice, [midi], len * STEP_SECONDS, 1, 0.24 * MIX.keys);
    }
  },
};

/**
 * ウッドベースの 1 音: はじいた弦（Karplus–Strong）に、胴の基音のサイン波を足し、ローパスで丸める。
 * 長さ length で左手を緩めて止める
 */
function uprightBass(voice: StepVoice, midi: number, length: number, accent: number, delay: number): void {
  const release = 0.08;
  const v = voice(delay + length + release * 4, 0.9 * accent * MIX.bass, BASS);
  if (!v) return;
  const ctx = v.ctx;
  const t = v.start + delay;
  const end = t + length;
  const stopAt = end + release * 4;
  const env = ctx.createGain();
  env.gain.setValueAtTime(1, t);
  env.gain.setTargetAtTime(0, end, release);
  env.connect(v.out);
  v.own(env);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(1100, t);
  lp.frequency.exponentialRampToValueAtTime(420, t + 0.35);
  lp.connect(env);
  v.own(lp);
  const src = ctx.createBufferSource();
  src.buffer = pluckBuffer(ctx, UPRIGHT, midi);
  src.connect(lp);
  src.start(t);
  src.stop(stopAt);
  v.track(src);
  const body = ctx.createGain();
  body.gain.setValueAtTime(0.0001, t);
  body.gain.linearRampToValueAtTime(0.35, t + 0.012);
  body.gain.exponentialRampToValueAtTime(0.12, t + 0.6);
  body.connect(env);
  v.own(body);
  oscillator(v, t, 'sine', midiToFreq(midi), stopAt, body);
}

/**
 * フェンダー・ローズの音（FM）: 鍵盤ごとに、同じ高さのサイン波で揺らして、叩いた瞬間だけ倍音の多い音にし、すぐ丸い音へ落とす。
 * 叩いた瞬間の金属の「チン」（高い比の FM）を短く重ね、わずかにずらした 2 つの音でうねらせ、ゆっくりしたトレモロをかける。
 * 長さ length で鍵盤を離して止める（離した後は短く消える）
 */
function rhodesNote(voice: StepVoice, midis: readonly number[], length: number, velocity: number, gain: number): void {
  const release = 0.12;
  const v = voice(length + release * 5 + 0.05, gain, KEYS);
  if (!v) return;
  const ctx = v.ctx;
  const t = v.start + Math.random() * 0.004;
  const end = t + length;
  const stopAt = end + release * 5;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3000;
  lp.Q.value = 0.5;
  lp.connect(v.out);
  v.own(lp);
  const trem = ctx.createGain();
  trem.gain.value = 0.85;
  trem.connect(lp);
  v.own(trem);
  const tremDepth = ctx.createGain();
  tremDepth.gain.value = 0.15;
  tremDepth.connect(trem.gain);
  v.own(tremDepth);
  oscillator(v, t, 'sine', 4.6, stopAt, tremDepth);
  midis.forEach((midi, i) => {
    const at = t + i * 0.012;
    const f = midiToFreq(midi);
    // 鍵盤の音量: 叩いてから長く減り、離したら短く消える
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(velocity, at + 0.003);
    env.gain.setTargetAtTime(velocity * 0.35, at + 0.003, 0.9);
    env.gain.setTargetAtTime(0, end, release);
    env.connect(trem);
    v.own(env);
    for (const cents of [-3, 3]) fmTine(v, at, f * 2 ** (cents / 1200), 0.9 * velocity, stopAt, env);
    const bell = ctx.createGain();
    bell.gain.setValueAtTime(0.0001, at);
    bell.gain.linearRampToValueAtTime(0.12 * velocity, at + 0.001);
    bell.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
    bell.connect(lp);
    v.own(bell);
    fmTine(v, at, f * 4, 3, at + 0.1, bell);
  });
}

/** FM の 1 音: f の carrier を、同じ高さの modulator で揺らす。揺らす深さは f × index から 0.5 秒で f × index × 0.12 へ下げる */
function fmTine(v: Voice, t: number, f: number, index: number, stopAt: number, dest: AudioNode): void {
  const carrier = oscillator(v, t, 'sine', f, stopAt, dest);
  const depth = v.ctx.createGain();
  depth.gain.setValueAtTime(f * index, t);
  depth.gain.exponentialRampToValueAtTime(f * index * 0.12, t + 0.5);
  depth.connect(carrier.frequency);
  v.own(depth);
  oscillator(v, t, 'sine', f, stopAt, depth);
}

/** バスドラムを柔らかく踏む: 低いサイン波の「ドゥン」と、フェルトのビーターの鈍い当たり */
function kick(voice: StepVoice, level: number): void {
  const v = voice(0.4, 0.55 * level * MIX.drums, DRUMS);
  if (!v) return;
  const t = v.start;
  glide(tone(v, t, 'sine', 82, 0.003, 0.28, 0.9).frequency, 48, t + 0.12);
  noise(v, t, 'lowpass', 900, 0.7, 0.001, 0.02, 0.12, Math.random());
}

/** ブラシでスネアの皮をこする 16 分（シェイカーのような「シャッ」）。拍の裏を強く */
function shaker(voice: StepVoice, accent: number, delay: number): void {
  const v = voice(delay + 0.12, 0.2 * accent * MIX.drums, DRUMS);
  if (!v) return;
  const t = v.start + delay;
  glide(noise(v, t, 'bandpass', 5200, 0.9, 0.006, 0.06, 0.5, Math.random()).frequency, 7000, t + 0.05);
}

/** クロススティック: スティックの胴でリムを叩く、木の乾いた「コッ」 */
function crossStick(voice: StepVoice): void {
  const v = voice(0.15, 0.32 * MIX.drums, DRUMS);
  if (!v) return;
  const t = v.start;
  noise(v, t, 'bandpass', 1900, 4, 0.0005, 0.045, 0.9, Math.random());
  tone(v, t, 'triangle', 520, 0.0005, 0.035, 0.35);
  tone(v, t, 'sine', 1250, 0.0005, 0.02, 0.2);
}

/** ハイハットを足で閉じる「チッ」（2 拍目と 4 拍目に、ごく小さく） */
function hatChick(voice: StepVoice): void {
  const v = voice(0.1, 0.12 * MIX.drums, DRUMS);
  if (!v) return;
  noise(v, v.start, 'bandpass', 8500, 1.2, 0.001, 0.04, 0.6, Math.random());
}

/** ブラックジャックの BGM。画面を開いている間ずっと使い回す */
export const createBlackjackBgm = (engine: AudioEngine, timer?: IntervalTimer): LayeredBgm => new LayeredBgm(engine, BLACKJACK_ARRANGEMENT, timer);
