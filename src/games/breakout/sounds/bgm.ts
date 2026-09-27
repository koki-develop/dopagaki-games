import type { AudioEngine, Voice, VoiceGroup, VoiceRequest } from '../../../juice/audio/engine.ts';
import { Sequencer } from '../../../juice/audio/sequencer.ts';
import type { IntervalTimer } from '../../../juice/audio/sequencer.ts';
import { DEFAULT_Q, envGain, glide, midiToFreq, noise, oscillator, stopTime, tone } from '../../../juice/audio/synth.ts';
import { clamp01 } from '../../../shared/math.ts';

const BGM_BPM = 128;
const STEPS_PER_BEAT = 4;
const STEPS_PER_BAR = 16;

/** 4 小節で 1 周するコード進行（Am → F → C → G）。ルートの MIDI 番号と、パッドの構成音 */
const PROGRESSION = [
  { root: 33, pad: [57, 60, 64, 67, 71] },
  { root: 29, pad: [53, 57, 60, 64, 67] },
  { root: 36, pad: [55, 60, 64, 67, 74] },
  { root: 31, pad: [55, 59, 62, 67, 69] },
] as const;

/** パッドの 1 音を 2 本のノコギリ波に分けるデチューン（セント） */
const PAD_DETUNE = 11;

/** 初期状態の値 */
const FILTER_OPEN = 18000;
const FILTER_CLOSED = 140;
const RISER_FILTER_BASE = 300;
const RISER_OSC_BASE = 110;

/** 一時停止で音を消し切るまで（秒）。プツッという音が出ない程度に短く */
const PAUSE_FADE = 0.015;
/** 再開で元の音量へ戻すまで（秒） */
const RESUME_FADE = 0.05;
/** これより小さい変化は無視する */
const EPSILON = 1e-4;
const RISER_EPSILON = 1e-3;

type BgmNodes = {
  filter: BiquadFilterNode;
  kick: GainNode;
  bass: GainNode;
  hat: GainNode;
  pad: GainNode;
  riserGain: GainNode;
  riserFilter: BiquadFilterNode;
  riserSrc: AudioBufferSourceNode;
  riserOsc: OscillatorNode;
  riserOscGain: GainNode;
};

const hatLevel = (tier: number): number => (tier >= 1 ? 1 : 0);
const padLevel = (tier: number): number => (tier >= 4 ? 1 : 0);
const riserNoiseLevel = (l: number): number => l * l * 0.35;
const riserOscLevel = (l: number): number => l * l * 0.08;
const opennessFreq = (openness: number): number => FILTER_CLOSED * (FILTER_OPEN / FILTER_CLOSED) ** clamp01(openness);

/** param を今の値から seconds 秒で value へ直線で動かす。予約済みの変化は取り消す */
function rampTo(param: AudioParam, value: number, t: number, seconds: number): void {
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(value, t + seconds);
}

/** param を今すぐ value にする。予約済みの変化は取り消す */
function setNow(param: AudioParam, value: number, t: number): void {
  param.cancelScheduledValues(t);
  param.setValueAtTime(value, t);
}

/**
 * BGM。キックとベースのループに、ボール数の段階に応じて層を足していく。
 *
 * - 段階 0: キック + ベース
 * - 段階 1（25〜）: ハイハットが入る
 * - 段階 3（250〜）: ベースラインが倍速になる
 * - 段階 4（500、MAX）: シンセのパッドが重なる
 *
 * 終盤の高まり用のライザー（ノイズの上昇音）と、全体のフィルタも持つ。
 * 画面を開いている間ずっと使い回し、プレイの始めに restart() で初期状態へ戻す。
 */
export class Bgm {
  private readonly e: AudioEngine;
  private readonly seq: Sequencer;
  private readonly group: VoiceGroup;
  private readonly req: VoiceRequest;
  private nodes: BgmNodes | null = null;
  private tier = 0;
  /**
   * 終盤の高まり（0〜1）。null はライザーを使っていない状態で、全体のフィルタは openness に従う。
   * 一度 setRiser を受け取ると、高まりが 0 でも全体のフィルタはライザーの基準（少しこもった音）になる
   */
  private riser: number | null = null;
  private openness = 1;
  private paused = false;
  private disposed = false;

  constructor(engine: AudioEngine, timer?: IntervalTimer) {
    this.e = engine;
    this.seq = new Sequencer(engine, BGM_BPM, STEPS_PER_BEAT, (step, time) => this.onStep(step, time), timer);
    this.group = engine.createGroup();
    this.req = { bus: 'bgm', duration: 0, gain: 1, when: 0, priority: 'normal', group: this.group };
  }

  /** 実際に聞こえている位置（拍単位）。背景やカメラをビートに合わせるのに使う。止めている間は進まない */
  beatPosition(): number {
    return this.seq.beatPosition();
  }

  /** 今のステップから鳴らし始める。一時停止中なら resume() と同じ */
  start(): void {
    if (this.disposed) return;
    if (this.paused) {
      this.resume();
      return;
    }
    this.ensureNodes();
    this.seq.start();
  }

  /** シーケンサーを止め、予約済みの音とハイハット・パッド・ライザーを今すぐ消す */
  pause(): void {
    if (this.disposed || this.paused) return;
    this.paused = true;
    this.seq.stop();
    this.group.stopAll(PAUSE_FADE);
    const n = this.nodes;
    if (!n) return;
    const t = this.e.now();
    rampTo(n.hat.gain, 0, t, PAUSE_FADE);
    rampTo(n.pad.gain, 0, t, PAUSE_FADE);
    rampTo(n.riserGain.gain, 0, t, PAUSE_FADE);
    rampTo(n.riserOscGain.gain, 0, t, PAUSE_FADE);
  }

  /** 一時停止したステップから続ける。層とライザーは今の段階・高まりの音量へ戻す */
  resume(): void {
    if (this.disposed || !this.paused) return;
    this.paused = false;
    const n = this.ensureNodes();
    if (n) {
      const t = this.e.now();
      rampTo(n.hat.gain, hatLevel(this.tier), t, RESUME_FADE);
      rampTo(n.pad.gain, padLevel(this.tier), t, RESUME_FADE);
      const l = this.riser ?? 0;
      rampTo(n.riserGain.gain, riserNoiseLevel(l), t, RESUME_FADE);
      rampTo(n.riserOscGain.gain, riserOscLevel(l), t, RESUME_FADE);
    }
    this.seq.start();
  }

  /**
   * 段階・ライザー・フィルタのすべてを今すぐ初期値へ戻し、ステップ 0 から数え直す。予約済みの音は消す。
   * 鳴っている・一時停止中・止まっている、の状態はそのまま保つ（鳴っているなら今からステップ 0 を鳴らす）。
   */
  restart(): void {
    if (this.disposed) return;
    this.group.stopAll(PAUSE_FADE);
    this.tier = 0;
    this.riser = null;
    this.openness = 1;
    this.seq.reset();
    const n = this.nodes;
    if (!n) return;
    const t = this.e.now();
    setNow(n.filter.frequency, FILTER_OPEN, t);
    setNow(n.kick.gain, 1, t);
    setNow(n.bass.gain, 1, t);
    setNow(n.hat.gain, 0, t);
    setNow(n.pad.gain, 0, t);
    setNow(n.riserGain.gain, 0, t);
    setNow(n.riserFilter.frequency, RISER_FILTER_BASE, t);
    setNow(n.riserOsc.frequency, RISER_OSC_BASE, t);
    setNow(n.riserOscGain.gain, 0, t);
  }

  /** ボール数の段階（0〜4）。変わったときだけ層を数秒かけて出し入れする */
  setTier(tier: number): void {
    if (this.disposed || Math.abs(tier - this.tier) < EPSILON) return;
    this.tier = tier;
    const n = this.nodes;
    if (!n || this.paused) return;
    const t = this.e.now();
    // 層は数秒かけてフェードで出し入れし、段階が変わった瞬間を目立たせない
    n.hat.gain.setTargetAtTime(hatLevel(tier), t, 1.2);
    n.pad.gain.setTargetAtTime(padLevel(tier), t, 1.5);
  }

  /**
   * 終盤の高まり。0 で無音、1 で最大。最初の呼び出しでライザーを使い始め、以後は変わったときだけ書き込む。
   * 使い始めると、全体のフィルタは高まりに合わせて開いていく（高まり 0 で 9 kHz、1 で 18 kHz）
   */
  setRiser(level: number): void {
    const l = clamp01(level);
    const prev = this.riser;
    if (this.disposed) return;
    if (prev !== null && (l === prev || (l !== 0 && Math.abs(l - prev) < RISER_EPSILON))) return;
    this.riser = l;
    const n = this.nodes;
    if (!n) return;
    const t = this.e.now();
    n.riserFilter.frequency.setTargetAtTime(RISER_FILTER_BASE + l * l * 7000, t, 0.1);
    n.riserOsc.frequency.setTargetAtTime(RISER_OSC_BASE * 2 ** (l * 3), t, 0.1);
    // 全体のフィルタも一緒に開いていく。使い始めたときは、ライザーの基準へ今すぐ切り替える（プレイの頭で音色が動かないように）
    if (prev === null) setNow(n.filter.frequency, 9000 + l * 9000, t);
    else n.filter.frequency.setTargetAtTime(9000 + l * 9000, t, 0.1);
    // 一時停止中は音量を 0 のまま保ち、再開したときにこの値へ戻す
    if (this.paused) return;
    n.riserGain.gain.setTargetAtTime(riserNoiseLevel(l), t, 0.1);
    n.riserOscGain.gain.setTargetAtTime(riserOscLevel(l), t, 0.1);
  }

  /** 全体のフィルタ。1 で開き切り、0 に近いほどこもる。seconds かけて動かす。値が変わったときだけ書き込む */
  setOpenness(openness: number, seconds: number): void {
    if (this.disposed || Math.abs(openness - this.openness) < EPSILON) return;
    this.openness = openness;
    const n = this.nodes;
    if (!n) return;
    const t = this.e.now();
    const f = n.filter.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.exponentialRampToValueAtTime(opennessFreq(openness), t + Math.max(0.01, seconds));
  }

  /** 鳴らし続けているライザーの音源を止め、ノードをすべて切り離す。以後は何も鳴らさない */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.seq.stop();
    this.group.stopAll(0);
    const n = this.nodes;
    this.nodes = null;
    if (!n) return;
    for (const src of [n.riserSrc, n.riserOsc]) {
      try {
        src.stop();
      } catch {
        // すでに止まった音源は無視する
      }
    }
    for (const node of [n.riserSrc, n.riserOsc, n.riserFilter, n.riserGain, n.riserOscGain, n.kick, n.bass, n.hat, n.pad, n.filter]) node.disconnect();
  }

  private ensureNodes(): BgmNodes | null {
    if (this.nodes || this.disposed) return this.nodes;
    const graph = this.e.graph;
    if (!graph) return null;
    const ctx = graph.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = FILTER_OPEN;
    filter.Q.value = 0.9;
    filter.connect(graph.bgmInput);
    const mk = (g: number) => {
      const n = ctx.createGain();
      n.gain.value = g;
      n.connect(filter);
      return n;
    };
    const kick = mk(1);
    const bass = mk(1);
    const hat = mk(0);
    const pad = mk(0);

    // ライザー: 常に鳴らしておき、音量とフィルタで出し入れする
    const riserGain = ctx.createGain();
    riserGain.gain.value = 0;
    riserGain.connect(filter);
    const riserFilter = ctx.createBiquadFilter();
    riserFilter.type = 'bandpass';
    riserFilter.Q.value = 1.4;
    riserFilter.frequency.value = RISER_FILTER_BASE;
    riserFilter.connect(riserGain);
    const riserSrc = ctx.createBufferSource();
    riserSrc.buffer = graph.noise;
    riserSrc.loop = true;
    riserSrc.connect(riserFilter);
    riserSrc.start();
    const riserOscGain = ctx.createGain();
    riserOscGain.gain.value = 0;
    riserOscGain.connect(filter);
    const riserOsc = ctx.createOscillator();
    riserOsc.type = 'sawtooth';
    riserOsc.frequency.value = RISER_OSC_BASE;
    riserOsc.connect(riserOscGain);
    riserOsc.start();

    const n: BgmNodes = { filter, kick, bass, hat, pad, riserGain, riserFilter, riserSrc, riserOsc, riserOscGain };
    this.nodes = n;
    // AudioContext ができる前に受け取った状態を反映する
    const t = ctx.currentTime;
    const l = this.riser ?? 0;
    const audible = !this.paused;
    setNow(hat.gain, audible ? hatLevel(this.tier) : 0, t);
    setNow(pad.gain, audible ? padLevel(this.tier) : 0, t);
    setNow(riserGain.gain, audible ? riserNoiseLevel(l) : 0, t);
    setNow(riserOscGain.gain, audible ? riserOscLevel(l) : 0, t);
    setNow(riserFilter.frequency, RISER_FILTER_BASE + l * l * 7000, t);
    setNow(riserOsc.frequency, RISER_OSC_BASE * 2 ** (l * 3), t);
    setNow(filter.frequency, this.riser !== null ? 9000 + l * 9000 : opennessFreq(this.openness), t);
    return n;
  }

  private open(duration: number, when: number, gain: number, dest: AudioNode): Voice | null {
    const r = this.req;
    r.duration = duration;
    r.when = when;
    r.gain = gain;
    r.dest = dest;
    return this.e.voice(r);
  }

  private onStep(step: number, time: number): void {
    const n = this.nodes;
    if (!n || !this.e.running) return;
    const inBar = step % STEPS_PER_BAR;
    const chord = PROGRESSION[Math.floor(step / STEPS_PER_BAR) % PROGRESSION.length];

    if (inBar % 4 === 0) this.kick(time, n.kick);

    if (this.tier >= 3) {
      if (inBar % 2 === 1) this.bass(time, chord.root + (inBar % 4 === 3 ? 12 : 0), n.bass, 0.11);
    } else if (inBar % 4 === 2) {
      this.bass(time, chord.root, n.bass, 0.2);
    }

    if (inBar % 2 === 0) this.hat(time, n.hat, inBar % 4 === 2 ? 1 : 0.55);

    if (inBar === 0 && this.tier >= 4) {
      this.pad(time, chord.pad, n.pad, (60 / BGM_BPM) * 4);
    }
  }

  private kick(t: number, dest: AudioNode): void {
    const v = this.open(0.4, t, 1, dest);
    if (!v) return;
    glide(tone(v, v.start, 'sine', 160, 0.002, 0.34, 0.95).frequency, 44, v.start + 0.09);
    noise(v, v.start, 'highpass', 3000, DEFAULT_Q, 0.001, 0.01, 0.18, 0);
  }

  private bass(t: number, midi: number, dest: AudioNode, len: number): void {
    const v = this.open(len + 0.05, t, 1, dest);
    if (!v) return;
    const lp = v.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(1600, v.start);
    lp.frequency.exponentialRampToValueAtTime(220, v.start + len);
    lp.connect(v.out);
    tone(v, v.start, 'sawtooth', midiToFreq(midi), 0.004, len, 0.32, lp);
    tone(v, v.start, 'sine', midiToFreq(midi - 12), 0.004, len, 0.4);
  }

  private hat(t: number, dest: AudioNode, accent: number): void {
    const v = this.open(0.08, t, accent, dest);
    if (!v) return;
    noise(v, v.start, 'highpass', 7500, DEFAULT_Q, 0.001, 0.05, 0.28, Math.random());
  }

  /** どのノコギリ波も同じエンベロープなので、1 つにまとめてからローパスへつなぐ */
  private pad(t: number, midis: readonly number[], dest: AudioNode, len: number): void {
    const v = this.open(len + 0.2, t, 1, dest);
    if (!v) return;
    const ctx = v.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    lp.Q.value = 0.5;
    lp.connect(v.out);
    const env = envGain(ctx, v.start, 0.25, len, 0.3 / Math.sqrt(midis.length * 2), lp);
    const end = stopTime(v.start, 0.25, len);
    for (let i = 0; i < midis.length; i++) {
      const f = midiToFreq(midis[i]);
      oscillator(v, v.start, 'sawtooth', f, end, env).detune.value = -PAD_DETUNE;
      oscillator(v, v.start, 'sawtooth', f, end, env).detune.value = PAD_DETUNE;
    }
  }
}
