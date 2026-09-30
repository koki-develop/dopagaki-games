/** 効果音と BGM を鳴らすか */
export type AudioSwitches = { sfx: boolean; bgm: boolean };

/** 音量は控えめに固定する。細かい調整は端末の音量で行う */
const VOLUME_MASTER = 0.45;
const VOLUME_SFX = 0.9;
const VOLUME_BGM = 0.7;
/** 音量は知覚に合わせて 2 乗のカーブにする。オフは 0 */
const MASTER_LEVEL = VOLUME_MASTER * VOLUME_MASTER;
const sfxLevel = (s: Readonly<AudioSwitches>): number => (s.sfx ? VOLUME_SFX * VOLUME_SFX : 0);
const bgmLevel = (s: Readonly<AudioSwitches>): number => (s.bgm ? VOLUME_BGM * VOLUME_BGM : 0);
/** 切り替えで音量を寄せる時定数（秒） */
const SWITCH_TAU = 0.02;
/** 一時停止で全体の音量を下げきるまで（秒）。下げきってから AudioContext を止める */
const PAUSE_FADE = 0.02;
/** 一時停止を解いて全体の音量を戻すまで（秒） */
const RESUME_FADE = 0.05;
/** 下げきるのを待つ実時間の余裕（ms）。タイマーの遅れで、下げきる前に止めないように */
const PAUSE_SUSPEND_MARGIN_MS = 30;

/** 一定時間後に 1 回だけ呼ぶタイマー */
export type DelayTimer = {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
};

const defaultDelay: DelayTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * sfx と bgm は silence() で消える。lead は silence() の影響を受けず、無音の中で鳴らす音に使う。
 * 共通の残響の出口は sfx のバスにつながっていて silence() で消えるので、lead の音は send() しない
 */
export type Bus = 'sfx' | 'bgm' | 'lead';

/**
 * 同時発音数の上限に達したときの扱い。
 * - normal: 一番古い normal の音から奪われる
 * - event: normal の音が 1 つでも残っている間は奪われない。normal の要求は event の音を奪わない
 */
export type VoicePriority = 'normal' | 'event';

/** voice() に渡す要求。エンジンはこのオブジェクトを保持しないので、呼び出し側で使い回してよい */
export type VoiceRequest = {
  bus: Bus;
  /** 鳴り終わるまでの長さ（秒）。この時刻を過ぎると後片付けする */
  duration: number;
  /** 出力の GainNode の音量 */
  gain: number;
  /** 鳴らし始める AudioContext の時刻。過去なら今すぐ */
  when?: number;
  /** 出力のつなぎ先。省略するとバスへつなぐ */
  dest?: AudioNode;
  priority?: VoicePriority;
  group?: VoiceGroup | null;
};

/** AudioContext と、音を組み立てるときに使う共有の部品 */
type AudioGraph = {
  readonly ctx: AudioContext;
  /** 1.5 秒のホワイトノイズ（モノラル）。読み出し位置をずらして使い回す */
  readonly noise: AudioBuffer;
  /** BGM バスの入口。BGM 側で独自のフィルタを挟むために使う */
  readonly bgmInput: GainNode;
  /** 効果音の共通の残響の入口。出口は効果音のバスにつながり、silence() で消える */
  readonly reverb: AudioNode;
  /** 歪みの曲線（WaveShaperNode.curve）。なだらかに頭を潰す */
  readonly drive: Float32Array<ArrayBuffer>;
};

/** 1 つの音（複数のノードの束）。voice の出力 GainNode に音源をつなぐ */
export type Voice = {
  /** この音のノードを作る AudioContext */
  readonly ctx: AudioContext;
  /** AudioGraph.noise と同じもの */
  readonly noise: AudioBuffer;
  /** AudioGraph.reverb と AudioGraph.drive と同じもの */
  readonly reverb: AudioNode;
  readonly drive: Float32Array<ArrayBuffer>;
  readonly out: GainNode;
  readonly start: number;
  readonly end: number;
  readonly priority: VoicePriority;
  readonly group: VoiceGroup | null;
  readonly sources: readonly AudioScheduledSourceNode[];
  /** 音源を登録する。voice を止めるときに一緒に止める */
  track(src: AudioScheduledSourceNode): void;
  /**
   * voice の外の、長く生きるノード（共通の残響など）へつなぐノードを登録する。
   * 鳴り終わって後片付けするときに、出力と一緒に切り離す
   */
  own(node: AudioNode): void;
  /** 今から fadeSeconds 秒でフェードアウトさせて止める */
  stop(fadeSeconds: number): void;
};

/** 鳴らしている音を途中で止める口 */
export type SoundHandle = { stop(): void };

/** 鳴らせなかったときに返す、何もしない SoundHandle */
export const NO_SOUND: SoundHandle = { stop: () => undefined };

/** 鳴らしている音を途中で止めるときに、音量を下げきるまでの長さ（秒） */
export const SOUND_STOP_FADE = 0.03;

/** voice を SOUND_STOP_FADE 秒で下げきって止める SoundHandle */
export const voiceHandle = (v: Voice): SoundHandle => ({ stop: () => v.stop(SOUND_STOP_FADE) });

/** silence() の取り消し口 */
export type SilenceHandle = {
  /**
   * この無音をやめる。ほかの silence() の無音が続いていれば、それが終わるまで無音のまま。
   * 元の音量へは DUCK_FADE 秒で戻す。2 回目以降の呼び出しは何もしない
   */
  cancel(): void;
};

/** silence() の無音の区間（AudioContext の時刻）。start から下げ始め、end まで無音を保ち、fadeIn 秒で戻す */
type SilenceWindow = { start: number; end: number; fadeIn: number };

/** 同時に鳴らせる音の数。効果音と BGM で枠を分ける */
const MAX_VOICES: Record<Bus, number> = { sfx: 24, bgm: 20, lead: 4 };
/** 奪われた音を消すフェードの長さ（秒） */
const STEAL_FADE = 0.015;
/** 鳴り終わってから後片付けするまでの余裕（秒） */
const REAP_MARGIN = 0.05;
/** silence() で音を下げ切るまでの時間（秒） */
const DUCK_FADE = 0.012;

const PRIORITY_RANK: Record<VoicePriority, number> = { normal: 0, event: 1 };

class VoiceState implements Voice {
  readonly ctx: AudioContext;
  readonly noise: AudioBuffer;
  readonly reverb: AudioNode;
  readonly drive: Float32Array<ArrayBuffer>;
  readonly out: GainNode;
  readonly start: number;
  end: number;
  readonly priority: VoicePriority;
  readonly rank: number;
  readonly group: VoiceGroup | null;
  readonly sources: AudioScheduledSourceNode[] = [];
  private readonly owned: AudioNode[] = [];

  constructor(graph: AudioGraph, out: GainNode, start: number, end: number, priority: VoicePriority, group: VoiceGroup | null) {
    this.ctx = graph.ctx;
    this.noise = graph.noise;
    this.reverb = graph.reverb;
    this.drive = graph.drive;
    this.out = out;
    this.start = start;
    this.end = end;
    this.priority = priority;
    this.rank = PRIORITY_RANK[priority];
    this.group = group;
  }

  track(src: AudioScheduledSourceNode): void {
    this.sources.push(src);
  }

  own(node: AudioNode): void {
    this.owned.push(node);
  }

  /** 鳴り終わった。出力と、外へつないだノードを切り離す */
  retire(): void {
    this.out.disconnect();
    for (const node of this.owned) node.disconnect();
  }

  stop(fadeSeconds: number): void {
    this.fadeOut(this.ctx.currentTime, Math.max(0.001, fadeSeconds));
  }

  /** now から fade 秒で音量を 0 へ下げ、音源を止める。鳴り終わる時刻（end）もそこまで早める */
  fadeOut(now: number, fade: number): void {
    const end = now + fade;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, end);
    for (const s of this.sources) {
      try {
        s.stop(end);
      } catch {
        // すでに止まった音源は無視する
      }
    }
    if (this.end > end) this.end = end;
  }
}

/** AudioContext と、そこに作ったバスの一式。AudioContext と同時にできる */
type Graph = AudioGraph & {
  /** 全体の音量。一時停止で下げる */
  readonly master: GainNode;
  /** silence() で下げる */
  readonly duck: GainNode;
  readonly buses: Readonly<Record<Bus, GainNode>>;
};

/** 残響の長さ（秒）と、響きが -60 dB まで減衰するまでの長さの目安 */
const REVERB_SECONDS = 1.8;
/** 残響の出口の音量 */
const REVERB_LEVEL = 0.55;
/** 歪みの曲線の細かさと、潰す強さ */
const DRIVE_SAMPLES = 2048;
const DRIVE_AMOUNT = 3;

/** xorshift の乱数で -1〜1 の値を data に書く。seed から決まった列にする */
function fillNoise(data: Float32Array, seed0: number, decay: (i: number) => number): void {
  let seed = seed0;
  for (let i = 0; i < data.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    data[i] = (((seed >>> 0) / 4294967296) * 2 - 1) * decay(i);
  }
}

/** なだらかに頭を潰す歪みの曲線（tanh を、端の出力が ±1 になるよう割る） */
function driveCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(DRIVE_SAMPLES);
  const norm = Math.tanh(DRIVE_AMOUNT);
  for (let i = 0; i < DRIVE_SAMPLES; i++) {
    const x = (i * 2) / (DRIVE_SAMPLES - 1) - 1;
    curve[i] = Math.tanh(DRIVE_AMOUNT * x) / norm;
  }
  return curve;
}

/**
 * バス・ノイズ・残響・歪みの曲線を作る。バスの音量は switches から決めた値で作る。
 * 経路: voice → (sfx | bgm) → duck → master → compressor → destination
 *       voice → lead → master（duck を通らない）
 *       voice の送り → reverb（ConvolverNode）→ sfx
 */
function buildGraph(ctx: AudioContext, switches: Readonly<AudioSwitches>, masterLevel: number): Graph {
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 10;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.2;
  compressor.connect(ctx.destination);

  const master = ctx.createGain();
  master.connect(compressor);
  const duck = ctx.createGain();
  duck.connect(master);
  const sfx = ctx.createGain();
  sfx.connect(duck);
  const bgm = ctx.createGain();
  bgm.connect(duck);
  const lead = ctx.createGain();
  lead.connect(master);
  master.gain.value = masterLevel;
  sfx.gain.value = sfxLevel(switches);
  lead.gain.value = sfxLevel(switches);
  bgm.gain.value = bgmLevel(switches);

  const len = Math.floor(ctx.sampleRate * 1.5);
  const noise = ctx.createBuffer(1, len, ctx.sampleRate);
  fillNoise(noise.getChannelData(0), 0x2f6b1a3d, () => 1);

  // 残響: 左右で別のノイズを指数的に減衰させたインパルス応答
  const irLen = Math.floor(ctx.sampleRate * REVERB_SECONDS);
  const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
  const k = Math.log(1000) / irLen;
  fillNoise(ir.getChannelData(0), 0x5a17c3e9, (i) => Math.exp(-k * i));
  fillNoise(ir.getChannelData(1), 0x1d2c9b47, (i) => Math.exp(-k * i));
  const convolver = ctx.createConvolver();
  convolver.buffer = ir;
  const reverbOut = ctx.createGain();
  reverbOut.gain.value = REVERB_LEVEL;
  convolver.connect(reverbOut);
  reverbOut.connect(sfx);

  return { ctx, noise, bgmInput: bgm, reverb: convolver, drive: driveCurve(), master, duck, buses: { sfx, bgm, lead } };
}

/**
 * 音のまとまり。1 回のプレイが鳴らす音をまとめておき、プレイを捨てるときにまとめて止める。
 * 止まるのはまとまりの音と、その音から共通の残響への送りまで。共通の残響にすでに入った響きは鳴り終わるまで残る。
 * AudioEngine.createGroup() で作る。
 */
export class VoiceGroup {
  private readonly stopFn: (group: VoiceGroup, fadeSeconds: number) => void;

  constructor(stop: (group: VoiceGroup, fadeSeconds: number) => void) {
    this.stopFn = stop;
  }

  /** このまとまりの音を fadeSeconds 秒でフェードアウトさせて止める。まだ鳴り始めていない予約も鳴らさない */
  stopAll(fadeSeconds: number): void {
    this.stopFn(this, fadeSeconds);
  }
}

const NOOP_SILENCE: SilenceHandle = { cancel: () => undefined };

function defaultContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
}

/**
 * Web Audio の土台。
 *
 * AudioContext は作るのに時間がかかる（ブラウザによっては 100 ms を超える）ので、preload() でユーザー操作の前に作っておける。
 * ページがまだユーザー操作を受けていなければ、作った AudioContext は止まった（suspended）状態のままになり、
 * ユーザー操作（pointerup / touchend / keydown）のハンドラの中で unlock() を呼ぶと動き出す。
 * すでに操作を受けたページでは、ブラウザが作ってすぐ動かすこともある。こちらから再開するのは unlock() の後だけ。
 *
 * ゲームの一時停止は setPaused() で伝える。止めている間は AudioContext ごと止めるので、鳴っている効果音も、
 * 無音の予定も、残響の尾も、その位置で止まり、解くとその位置から続く。止めている間は、画面が見えるようになっても、
 * ユーザー操作があっても、unlock() を呼んでも動かさない。
 */
export class AudioEngine {
  private built: Graph | null = null;
  private readonly createContext: () => AudioContext | null;
  private unlocked = false;
  private readonly voices: Record<Bus, VoiceState[]> = { sfx: [], bgm: [], lead: [] };
  /** 奪われたり止められたりして、フェードアウト中の音。枠は数えない */
  private readonly releasing: VoiceState[] = [];
  /** 終わっていない silence() の区間 */
  private silences: SilenceWindow[] = [];
  /**
   * duck の音量の予定。時刻と値の点を直線でつないだもので、最初の点より前は最初の値、最後の点より後は最後の値。
   * 予定を組み直すときは、ここから今の音量を求める
   */
  private duckTimes: number[] = [0];
  private duckValues: number[] = [1];
  private needsResume = false;
  private hidden = false;
  /** ゲームの一時停止 */
  private paused = false;
  private readonly delay: DelayTimer;
  /** 一時停止で、下げきってから AudioContext を止めるタイマー */
  private suspendTimer: unknown = null;
  /** 全体の音量の、最後に組んだ変化（AudioContext の時刻 t0 に from、t1 に to で、その間は直線） */
  private masterFrom = MASTER_LEVEL;
  private masterTo = MASTER_LEVEL;
  private masterT0 = 0;
  private masterT1 = 0;
  private readonly switches: AudioSwitches = { sfx: true, bgm: true };
  private readonly fallbackOrigin = typeof performance !== 'undefined' ? performance.now() : 0;

  /**
   * @param createContext AudioContext を作る。作れない環境では null を返す
   * @param delay 一時停止で、音量を下げきってから AudioContext を止めるのに使うタイマー
   */
  constructor(createContext: () => AudioContext | null = defaultContext, delay: DelayTimer = defaultDelay) {
    this.createContext = createContext;
    this.delay = delay;
    if (typeof window === 'undefined') return;
    document.addEventListener('visibilitychange', this.onVisibility);
    // 中断（通話など）や復帰に失敗したあとは、次のユーザー操作で再開を試みる
    const retry = () => {
      const ctx = this.built?.ctx;
      if (this.needsResume || (ctx && ctx.state !== 'running' && !this.hidden && !this.paused)) void this.resume();
    };
    window.addEventListener('pointerup', retry, true);
    window.addEventListener('touchend', retry, true);
    window.addEventListener('keydown', retry, true);
  }

  get ctx(): AudioContext | null {
    return this.built?.ctx ?? null;
  }

  /** AudioContext と共有の部品。AudioContext を作るまでは null */
  get graph(): AudioGraph | null {
    return this.built;
  }

  get running(): boolean {
    return this.built?.ctx.state === 'running';
  }

  /**
   * AudioContext をまだ作っていなければ作る。ユーザー操作の外で呼んでよく、こちらからは再開しない
   */
  preload(): void {
    this.ensureGraph();
  }

  /**
   * ユーザー操作のハンドラの中で呼ぶ。AudioContext を動かす（まだ作っていなければ作る）。
   */
  unlock(): void {
    if (!this.ensureGraph()) return;
    this.unlocked = true;
    void this.resume();
  }

  /** 音の時刻の基準（秒）。AudioContext が無いときは実時間で代用する */
  now(): number {
    const ctx = this.built?.ctx;
    if (ctx) return ctx.currentTime;
    return (performance.now() - this.fallbackOrigin) / 1000;
  }

  /** 予約した時刻から、実際にスピーカーから聞こえるまでの遅れ（秒） */
  latency(): number {
    const ctx = this.built?.ctx;
    return ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0;
  }

  createGroup(): VoiceGroup {
    return new VoiceGroup(this.stopGroup);
  }

  /**
   * 新しい voice を確保する。鳴らせない（AudioContext が動いていない）ときは null。
   * 同時発音数の上限に達していれば、優先度の低い音のうち一番古いものを素早くフェードアウトさせて枠を空ける。
   * normal の要求で空けられる枠が無い（event の音で埋まっている）ときは null。
   */
  voice(req: VoiceRequest): Voice | null {
    const g = this.built;
    if (!g || g.ctx.state !== 'running') return null;
    const ctx = g.ctx;
    const now = ctx.currentTime;
    const pool = this.voices[req.bus];
    reapPool(pool, now);
    reapPool(this.releasing, now);
    const priority = req.priority ?? 'normal';
    if (pool.length >= MAX_VOICES[req.bus] && !this.steal(pool, PRIORITY_RANK[priority], now)) return null;
    const start = Math.max(now, req.when ?? 0);
    const out = ctx.createGain();
    out.gain.value = req.gain;
    out.connect(req.dest ?? g.buses[req.bus]);
    const v = new VoiceState(g, out, start, start + req.duration, priority, req.group ?? null);
    pool.push(v);
    return v;
  }

  /** 毎フレーム呼ぶ。鳴り終わった voice を片付けて、activeVoices() を正確に保つ */
  tick(): void {
    const ctx = this.built?.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    reapPool(this.voices.sfx, now);
    reapPool(this.voices.bgm, now);
    reapPool(this.voices.lead, now);
    reapPool(this.releasing, now);
  }

  activeVoices(bus: Bus): number {
    return this.voices[bus].length;
  }

  /**
   * 今から delay 秒後に、効果音と BGM を duration 秒だけ無音にしてから fadeIn 秒で戻す。lead の音だけが聞こえる状態になる。
   * 下げきるまでに DUCK_FADE 秒かかるので、それより短い duration は DUCK_FADE として扱う（どの長さでも必ず元の音量へ戻る）。
   * 無音の区間は重ねてよく、どれかの区間の中にいる間は無音を保つ。後の呼び出しが前の無音を縮めることはない
   */
  silence(duration: number, fadeIn = 0.02, delay = 0): SilenceHandle {
    const graph = this.built;
    if (!graph) return NOOP_SILENCE;
    const start = graph.ctx.currentTime + Math.max(0, delay);
    const w: SilenceWindow = { start, end: start + Math.max(DUCK_FADE, duration), fadeIn: Math.max(0.001, fadeIn) };
    this.silences.push(w);
    this.scheduleDuck(graph);
    let active = true;
    return {
      cancel: () => {
        if (!active) return;
        active = false;
        const i = this.silences.indexOf(w);
        if (i < 0) return;
        this.silences.splice(i, 1);
        this.scheduleDuck(graph);
      },
    };
  }

  /** 時刻 t の duck の音量を、組んである予定から求める */
  private duckAt(t: number): number {
    const ts = this.duckTimes;
    const vs = this.duckValues;
    if (t <= ts[0]) return vs[0];
    for (let i = 1; i < ts.length; i++) {
      if (t < ts[i]) return vs[i - 1] + ((vs[i] - vs[i - 1]) * (t - ts[i - 1])) / (ts[i] - ts[i - 1]);
    }
    return vs[vs.length - 1];
  }

  /**
   * 終わっていない無音の区間をすべて合わせて、duck の予定を今から組み直す。
   * 今の音量から始め、区間ごとに DUCK_FADE 秒で下げ、区間の終わりまで保ち、fadeIn 秒で戻す。
   * 重なる区間（戻りきる前に次が始まるものを含む）は 1 つにまとめ、いちばん遅く終わる区間の fadeIn で戻す。
   * 区間の外にいるのに下がっているときは、DUCK_FADE 秒で元の音量へ戻す
   */
  private scheduleDuck(graph: Graph): void {
    const now = graph.ctx.currentTime;
    const level = this.duckAt(now);
    const live = this.silences.filter((w) => w.end + w.fadeIn > now).sort((a, b) => a.start - b.start);
    this.silences = live;
    const merged: SilenceWindow[] = [];
    for (const w of live) {
      const last = merged.at(-1);
      if (last && w.start <= last.end + last.fadeIn) {
        if (w.end > last.end || (w.end === last.end && w.fadeIn > last.fadeIn)) {
          last.end = w.end;
          last.fadeIn = w.fadeIn;
        }
      } else {
        merged.push({ ...w });
      }
    }

    const ts = [now];
    const vs = [level];
    let at = now;
    let v = level;
    const to = (time: number, value: number) => {
      ts.push(time);
      vs.push(value);
      at = time;
      v = value;
    };
    for (const w of merged) {
      if (now >= w.end) {
        // 戻っている途中: 残りの時間で戻しきる
        to(w.end + w.fadeIn, 1);
        continue;
      }
      if (w.start > at) {
        if (v < 1 && at + DUCK_FADE <= w.start) to(at + DUCK_FADE, 1);
        if (w.start > at) to(w.start, v);
      }
      to(at + DUCK_FADE, 0);
      if (w.end > at) to(w.end, 0);
      to(at + w.fadeIn, 1);
    }
    if (v < 1) to(at + DUCK_FADE, 1);
    this.duckTimes = ts;
    this.duckValues = vs;

    const g = graph.duck.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(level, now);
    for (let i = 1; i < ts.length; i++) g.linearRampToValueAtTime(vs[i], ts[i]);
  }

  /** AudioContext とバスを作る。作れない環境では null。一時停止中なら、全体の音量を 0 にして止めておく */
  private ensureGraph(): Graph | null {
    if (this.built) return this.built;
    const ctx = this.createContext();
    if (!ctx) return null;
    const level = this.paused ? 0 : MASTER_LEVEL;
    const graph = buildGraph(ctx, this.switches, level);
    this.built = graph;
    this.masterFrom = this.masterTo = level;
    this.masterT0 = this.masterT1 = ctx.currentTime;
    ctx.addEventListener('statechange', () => {
      if (ctx.state !== 'running' && !this.hidden && !this.paused) this.needsResume = true;
    });
    if (this.paused) void ctx.suspend().catch(() => undefined);
    return graph;
  }

  /**
   * ゲームの一時停止。止めるときは全体の音量を PAUSE_FADE 秒で下げきってから AudioContext を止め、
   * 解くときは AudioContext を動かして RESUME_FADE 秒で元の音量へ戻す。下げている途中で解いたら、止めずにその音量から戻す
   */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.delay.clear(this.suspendTimer);
    this.suspendTimer = null;
    const g = this.built;
    if (!g) return;
    if (paused) {
      this.rampMaster(g, 0, PAUSE_FADE);
      this.suspendTimer = this.delay.set(() => {
        this.suspendTimer = null;
        if (this.paused) void g.ctx.suspend().catch(() => undefined);
      }, PAUSE_FADE * 1000 + PAUSE_SUSPEND_MARGIN_MS);
    } else {
      this.rampMaster(g, MASTER_LEVEL, RESUME_FADE);
      void this.resume();
    }
  }

  /** 全体の音量を、今の音量から seconds 秒で level へ直線で動かす */
  private rampMaster(g: Graph, level: number, seconds: number): void {
    const now = g.ctx.currentTime;
    const from = this.masterAt(now);
    const p = g.master.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(from, now);
    p.linearRampToValueAtTime(level, now + seconds);
    this.masterFrom = from;
    this.masterTo = level;
    this.masterT0 = now;
    this.masterT1 = now + seconds;
  }

  /** 時刻 t の全体の音量を、組んである変化から求める */
  private masterAt(t: number): number {
    if (t <= this.masterT0) return this.masterFrom;
    if (t >= this.masterT1) return this.masterTo;
    return this.masterFrom + ((this.masterTo - this.masterFrom) * (t - this.masterT0)) / (this.masterT1 - this.masterT0);
  }

  /** 効果音と BGM を鳴らすか。開いているゲームの設定から渡す */
  setEnabled(switches: Readonly<AudioSwitches>): void {
    if (this.switches.sfx === switches.sfx && this.switches.bgm === switches.bgm) return;
    this.switches.sfx = switches.sfx;
    this.switches.bgm = switches.bgm;
    this.applySettings();
  }

  private applySettings(): void {
    const g = this.built;
    if (!g) return;
    const s = this.switches;
    const t = g.ctx.currentTime;
    g.buses.sfx.gain.setTargetAtTime(sfxLevel(s), t, SWITCH_TAU);
    g.buses.bgm.gain.setTargetAtTime(bgmLevel(s), t, SWITCH_TAU);
    g.buses.lead.gain.setTargetAtTime(sfxLevel(s), t, SWITCH_TAU);
  }

  /** unlock() を呼んだ後だけ動かす。それまではユーザー操作の外で動き出さないようにする。一時停止中は動かさない */
  private async resume(): Promise<void> {
    const ctx = this.built?.ctx;
    if (!ctx || this.hidden || !this.unlocked || this.paused) return;
    try {
      await ctx.resume();
      this.needsResume = ctx.state !== 'running';
    } catch {
      this.needsResume = true;
    }
  }

  private readonly onVisibility = (): void => {
    this.hidden = document.visibilityState === 'hidden';
    const ctx = this.built?.ctx;
    if (!ctx) return;
    if (this.hidden) {
      void ctx.suspend().catch(() => undefined);
    } else {
      void this.resume();
    }
  };

  /** 優先度 rank 以下の音のうち、一番低い優先度の一番古い音を止めて枠を空ける。空けられなければ false */
  private steal(pool: VoiceState[], rank: number, now: number): boolean {
    let victim = -1;
    for (let i = 0; i < pool.length; i++) {
      if (victim < 0 || pool[i].rank < pool[victim].rank) victim = i;
    }
    if (victim < 0 || pool[victim].rank > rank) return false;
    const v = pool[victim];
    pool.splice(victim, 1);
    this.release(v, now, STEAL_FADE);
    return true;
  }

  private release(v: VoiceState, now: number, fade: number): void {
    v.fadeOut(now, fade);
    this.releasing.push(v);
  }

  private readonly stopGroup = (group: VoiceGroup, fadeSeconds: number): void => {
    const ctx = this.built?.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const fade = Math.max(0.001, fadeSeconds);
    for (const bus of BUSES) {
      const pool = this.voices[bus];
      let w = 0;
      for (let r = 0; r < pool.length; r++) {
        const v = pool[r];
        if (v.group === group) this.release(v, now, fade);
        else pool[w++] = v;
      }
      pool.length = w;
    }
  };

}

const BUSES: readonly Bus[] = ['sfx', 'bgm', 'lead'];

/** 鳴り終わった voice を切り離して取り除く。順番（古い順）は保つ */
function reapPool(pool: VoiceState[], now: number): void {
  let w = 0;
  for (let r = 0; r < pool.length; r++) {
    const v = pool[r];
    if (v.end + REAP_MARGIN < now) v.retire();
    else pool[w++] = v;
  }
  pool.length = w;
}

export const audio = new AudioEngine();
