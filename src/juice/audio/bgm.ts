import { clamp01 } from '../../shared/math.ts';
import type { AudioEngine, Voice, VoiceGroup, VoiceRequest } from './engine.ts';
import { Sequencer } from './sequencer.ts';
import type { IntervalTimer } from './sequencer.ts';

/** ステップの音を鳴らす枠を確保する。時刻はそのステップの時刻、つなぎ先は層 layer */
export type StepVoice = (duration: number, gain: number, layer: number) => Voice | null;

/**
 * 曲の中身。LayeredBgm がステップごとに play を呼ぶ。
 * 層は GainNode 1 つずつで、段階（tier）に応じた音量で出し入れする
 */
export interface Arrangement {
  readonly bpm: number;
  readonly stepsPerBeat: number;
  readonly layerCount: number;
  /** 段階 tier のときの、層 layer の音量（0〜1） */
  layerLevel(layer: number, tier: number): number;
  /** 段階が変わったときに、層の音量を寄せる時定数（秒） */
  layerTau(layer: number): number;
  /** ステップ step（時刻 time）の音を予約する。音の枠は voice で確保する */
  play(step: number, time: number, tier: number, voice: StepVoice): void;
}

const FILTER_OPEN = 18000;
const FILTER_CLOSED = 140;
const RISER_FILTER_BASE = 300;
const RISER_OSC_BASE = 110;
/** ライザーを使っているときの全体のフィルタの上限。高まり 0 で RISER_OPEN_BASE、1 で FILTER_OPEN */
const RISER_OPEN_BASE = 9000;
/** ライザーの音量と音色を、高まりへ寄せる時定数（秒） */
const RISER_TAU = 0.1;
/** 高まりの変化で全体のフィルタを動かすときに、行き先へ着くまで（秒） */
const RISER_FILTER_SECONDS = 0.3;

/** 一時停止で音を消し切るまで（秒）。プツッという音が出ない程度に短く */
const PAUSE_FADE = 0.015;
/** 再開で元の音量へ戻すまで（秒） */
const RESUME_FADE = 0.05;
/** これより小さい変化は無視する */
const EPSILON = 1e-4;
const RISER_EPSILON = 1e-3;
/** 全体のフィルタの行き先の変化のうち、これより小さい割合の変化は無視する */
const FILTER_EPSILON = 1e-4;

type BgmNodes = {
  filter: BiquadFilterNode;
  layers: GainNode[];
};

/** ライザーのノード。使い始めたときに作り、restart() で止めて捨てる */
type RiserNodes = {
  gain: GainNode;
  filter: BiquadFilterNode;
  src: AudioBufferSourceNode;
  osc: OscillatorNode;
  oscGain: GainNode;
};

const riserNoiseLevel = (l: number): number => l * l * 0.35;
const riserOscLevel = (l: number): number => l * l * 0.08;
const riserBandFreq = (l: number): number => RISER_FILTER_BASE + l * l * 7000;
const riserOscFreq = (l: number): number => RISER_OSC_BASE * 2 ** (l * 3);
const opennessFreq = (openness: number): number => FILTER_CLOSED * (FILTER_OPEN / FILTER_CLOSED) ** clamp01(openness);
const riserOpenFreq = (l: number): number => RISER_OPEN_BASE + l * (FILTER_OPEN - RISER_OPEN_BASE);

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
 * BGM の土台。曲の中身（Arrangement）をシーケンサーで鳴らし、段階に応じて層を出し入れする。
 * 終盤の高まり用のライザー（ノイズとノコギリ波の上昇音）と、全体のフィルタも持つ。
 *
 * 全体のフィルタの周波数は、開き具合（setOpenness）とライザーの高まり（setRiser）の 2 つの状態から決め、
 * 低いほうへ 1 本の変化で寄せる。どちらの呼び出しも、もう一方が予約した変化を消さない。
 *
 * 画面を開いている間ずっと使い回し、プレイの始めに restart() で初期状態へ戻す。
 * ノードは AudioContext ができてから作り、それまでに受け取った設定は作ったときに反映する。
 */
export class LayeredBgm {
  private readonly e: AudioEngine;
  private readonly arr: Arrangement;
  private readonly seq: Sequencer;
  private readonly group: VoiceGroup;
  private readonly req: VoiceRequest;
  private nodes: BgmNodes | null = null;
  private riserNodes: RiserNodes | null = null;
  private tier = 0;
  /**
   * 終盤の高まり（0〜1）。null はライザーを使っていない状態で、全体のフィルタは openness だけで決まる。
   * 一度 setRiser を受け取ると、高まりが 0 でも全体のフィルタはライザーの基準（少しこもった音）以下になる
   */
  private riser: number | null = null;
  private openness = 1;
  /** 全体のフィルタへ最後に予約した行き先（Hz）と、その変化が終わる AudioContext の時刻 */
  private filterTarget = FILTER_OPEN;
  private filterRampEnd = 0;
  private paused = false;
  private disposed = false;
  /** play に渡している間の、ステップの時刻 */
  private stepTime = 0;

  constructor(engine: AudioEngine, arrangement: Arrangement, timer?: IntervalTimer) {
    this.e = engine;
    this.arr = arrangement;
    this.seq = new Sequencer(engine, arrangement.bpm, arrangement.stepsPerBeat, (step, time) => this.onStep(step, time), timer);
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

  /**
   * シーケンサーを止め、予約済みの音とライザーを今すぐ消す。
   * 層の音はすべて予約済みの音なので、層の音量は段階のまま保つ（再開した直後の音を弱めないように）
   */
  pause(): void {
    if (this.disposed || this.paused) return;
    this.paused = true;
    this.seq.stop();
    this.group.stopAll(PAUSE_FADE);
    const r = this.riserNodes;
    if (!r) return;
    const t = this.e.now();
    rampTo(r.gain.gain, 0, t, PAUSE_FADE);
    rampTo(r.oscGain.gain, 0, t, PAUSE_FADE);
  }

  /** 一時停止したステップから続ける。ライザーは今の高まりの音量へ戻す */
  resume(): void {
    if (this.disposed || !this.paused) return;
    this.paused = false;
    this.ensureNodes();
    const r = this.riserNodes;
    if (r) {
      const t = this.e.now();
      const l = this.riser ?? 0;
      rampTo(r.gain.gain, riserNoiseLevel(l), t, RESUME_FADE);
      rampTo(r.oscGain.gain, riserOscLevel(l), t, RESUME_FADE);
    }
    this.seq.start();
  }

  /**
   * 段階・ライザー・フィルタのすべてを今すぐ初期値へ戻し、ステップ 0 から数え直す。予約済みの音は消す。
   * ライザーの音源は止めて捨てる。
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
    this.releaseRiser(t);
    this.filterTarget = FILTER_OPEN;
    this.filterRampEnd = t;
    setNow(n.filter.frequency, FILTER_OPEN, t);
    for (let i = 0; i < n.layers.length; i++) setNow(n.layers[i].gain, this.arr.layerLevel(i, 0), t);
  }

  /** 段階。変わったときだけ、層を時定数 layerTau で出し入れする */
  setTier(tier: number): void {
    if (this.disposed || Math.abs(tier - this.tier) < EPSILON) return;
    this.tier = tier;
    const n = this.nodes;
    if (!n) return;
    const t = this.e.now();
    for (let i = 0; i < n.layers.length; i++) n.layers[i].gain.setTargetAtTime(this.arr.layerLevel(i, tier), t, this.arr.layerTau(i));
  }

  /**
   * 終盤の高まり。0 で無音、1 で最大。最初の呼び出しでライザーの音源を作って使い始め、以後は変わったときだけ書き込む。
   * 使い始めると、全体のフィルタの上限は高まりに合わせて開いていく（高まり 0 で 9 kHz、1 で 18 kHz）。
   * 使い始めの切り替えは、全体のフィルタが動いている途中でなければ今すぐ行う（プレイの頭で音色が動かないように）
   */
  setRiser(level: number): void {
    const l = clamp01(level);
    const prev = this.riser;
    if (this.disposed) return;
    if (prev !== null && (l === prev || (l !== 0 && Math.abs(l - prev) < RISER_EPSILON))) return;
    this.riser = l;
    if (!this.nodes) return;
    const t = this.e.now();
    const r = this.riserNodes;
    if (r) {
      r.filter.frequency.setTargetAtTime(riserBandFreq(l), t, RISER_TAU);
      r.osc.frequency.setTargetAtTime(riserOscFreq(l), t, RISER_TAU);
      // 一時停止中は音量を 0 のまま保ち、再開したときにこの値へ戻す
      if (!this.paused) {
        r.gain.gain.setTargetAtTime(riserNoiseLevel(l), t, RISER_TAU);
        r.oscGain.gain.setTargetAtTime(riserOscLevel(l), t, RISER_TAU);
      }
    } else {
      this.ensureRiser();
    }
    this.retargetFilter(t, RISER_FILTER_SECONDS, prev === null);
  }

  /** 全体のフィルタの開き具合。1 で開き切り、0 に近いほどこもる。seconds かけて動かす。値が変わったときだけ書き込む */
  setOpenness(openness: number, seconds: number): void {
    if (this.disposed || Math.abs(openness - this.openness) < EPSILON) return;
    this.openness = openness;
    if (!this.nodes) return;
    this.retargetFilter(this.e.now(), Math.max(0.01, seconds), false);
  }

  /** ライザーの音源を止め、ノードをすべて切り離す。以後は何も鳴らさない */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.seq.stop();
    this.group.stopAll(0);
    const n = this.nodes;
    this.nodes = null;
    const r = this.riserNodes;
    this.riserNodes = null;
    if (r) {
      for (const src of [r.src, r.osc]) {
        try {
          src.stop();
        } catch {
          // すでに止まった音源は無視する
        }
      }
      disconnectRiser(r);
    }
    if (!n) return;
    for (const node of [...n.layers, n.filter]) node.disconnect();
  }

  /** 開き具合とライザーの高まりから決まる、全体のフィルタの周波数。低いほうに従う */
  private filterFreq(): number {
    const open = opennessFreq(this.openness);
    return this.riser === null ? open : Math.min(open, riserOpenFreq(this.riser));
  }

  /**
   * 全体のフィルタを、今の状態から決まる周波数へ寄せる。行き先が変わらなければ何もしない。
   * 動いている途中の変化より早くは着かせない（ゲームオーバーでこもっていく途中に、高まりの変化で急に閉じないように）。
   * immediate なら、動いている途中でない限り今すぐ切り替える
   */
  private retargetFilter(t: number, seconds: number, immediate: boolean): void {
    const n = this.nodes;
    if (!n) return;
    const target = this.filterFreq();
    if (Math.abs(target - this.filterTarget) <= target * FILTER_EPSILON) return;
    this.filterTarget = target;
    const f = n.filter.frequency;
    if (immediate && t >= this.filterRampEnd) {
      setNow(f, target, t);
      this.filterRampEnd = t;
      return;
    }
    const end = Math.max(t + seconds, this.filterRampEnd);
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.exponentialRampToValueAtTime(target, end);
    this.filterRampEnd = end;
  }

  private ensureNodes(): BgmNodes | null {
    if (this.nodes || this.disposed) return this.nodes;
    const graph = this.e.graph;
    if (!graph) return null;
    const ctx = graph.ctx;
    const t = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.9;
    filter.connect(graph.bgmInput);
    const layers: GainNode[] = [];
    for (let i = 0; i < this.arr.layerCount; i++) {
      const g = ctx.createGain();
      g.connect(filter);
      layers.push(g);
    }
    this.nodes = { filter, layers };
    // AudioContext ができる前に受け取った状態を反映する
    for (let i = 0; i < layers.length; i++) setNow(layers[i].gain, this.arr.layerLevel(i, this.tier), t);
    this.filterTarget = this.filterFreq();
    this.filterRampEnd = t;
    setNow(filter.frequency, this.filterTarget, t);
    if (this.riser !== null) this.ensureRiser();
    return this.nodes;
  }

  /** ライザーの音源を作り、今の高まりの音量と音色で鳴らし始める。音量とフィルタで出し入れする */
  private ensureRiser(): void {
    const n = this.nodes;
    const graph = this.e.graph;
    if (this.riserNodes || !n || !graph) return;
    const ctx = graph.ctx;
    const t = ctx.currentTime;
    const l = this.riser ?? 0;
    const audible = !this.paused;
    const gain = ctx.createGain();
    setNow(gain.gain, audible ? riserNoiseLevel(l) : 0, t);
    gain.connect(n.filter);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    setNow(filter.frequency, riserBandFreq(l), t);
    filter.connect(gain);
    const src = ctx.createBufferSource();
    src.buffer = graph.noise;
    src.loop = true;
    src.connect(filter);
    src.start(t);
    const oscGain = ctx.createGain();
    setNow(oscGain.gain, audible ? riserOscLevel(l) : 0, t);
    oscGain.connect(n.filter);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    setNow(osc.frequency, riserOscFreq(l), t);
    osc.connect(oscGain);
    osc.start(t);
    this.riserNodes = { gain, filter, src, osc, oscGain };
  }

  /** ライザーの音量を PAUSE_FADE 秒で下げてから音源を止め、止まったらノードを切り離す */
  private releaseRiser(t: number): void {
    const r = this.riserNodes;
    if (!r) return;
    this.riserNodes = null;
    rampTo(r.gain.gain, 0, t, PAUSE_FADE);
    rampTo(r.oscGain.gain, 0, t, PAUSE_FADE);
    r.osc.onended = () => disconnectRiser(r);
    r.src.stop(t + PAUSE_FADE);
    r.osc.stop(t + PAUSE_FADE);
  }

  private readonly voiceAt: StepVoice = (duration, gain, layer) => {
    const n = this.nodes;
    if (!n) return null;
    const r = this.req;
    r.duration = duration;
    r.when = this.stepTime;
    r.gain = gain;
    r.dest = n.layers[layer];
    return this.e.voice(r);
  };

  private onStep(step: number, time: number): void {
    if (!this.nodes) return;
    this.stepTime = time;
    this.arr.play(step, time, this.tier, this.voiceAt);
  }
}

function disconnectRiser(r: RiserNodes): void {
  for (const node of [r.src, r.osc, r.filter, r.gain, r.oscGain]) node.disconnect();
}
