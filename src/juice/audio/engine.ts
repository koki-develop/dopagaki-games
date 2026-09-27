import { settings, VOLUME_BGM, VOLUME_MASTER, VOLUME_SFX } from '../settings.ts';

/** sfx と bgm は silence() で消える。lead は silence() の影響を受けず、無音の中で鳴らす音に使う */
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
};

/** 1 つの音（複数のノードの束）。voice の出力 GainNode に音源をつなぐ */
export type Voice = {
  /** この音のノードを作る AudioContext */
  readonly ctx: AudioContext;
  /** AudioGraph.noise と同じもの */
  readonly noise: AudioBuffer;
  readonly out: GainNode;
  readonly start: number;
  readonly end: number;
  readonly priority: VoicePriority;
  readonly group: VoiceGroup | null;
  readonly sources: readonly AudioScheduledSourceNode[];
  /** 音源を登録する。voice を止めるときに一緒に止める */
  track(src: AudioScheduledSourceNode): void;
};

/** silence() の取り消し口 */
type SilenceHandle = {
  /** 無音をやめて、今すぐ元の音量へ戻す。後から別の silence() が始まっていれば何もしない */
  cancel(): void;
};

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
  readonly out: GainNode;
  readonly start: number;
  end: number;
  readonly priority: VoicePriority;
  readonly rank: number;
  readonly group: VoiceGroup | null;
  readonly sources: AudioScheduledSourceNode[] = [];

  constructor(graph: AudioGraph, out: GainNode, start: number, end: number, priority: VoicePriority, group: VoiceGroup | null) {
    this.ctx = graph.ctx;
    this.noise = graph.noise;
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
}

/** AudioContext と、そこに作ったバスの一式。AudioContext と同時にできる */
type Graph = AudioGraph & {
  /** 音量の設定 */
  readonly master: GainNode;
  /** silence() で下げる */
  readonly duck: GainNode;
  readonly buses: Readonly<Record<Bus, GainNode>>;
};

/**
 * バスとノイズを作る。
 * 経路: voice → (sfx | bgm) → duck → master → compressor → destination
 *       voice → lead → master（duck を通らない）
 */
function buildGraph(ctx: AudioContext): Graph {
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

  const len = Math.floor(ctx.sampleRate * 1.5);
  const noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 0x2f6b1a3d;
  for (let i = 0; i < len; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    data[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
  }
  return { ctx, noise, bgmInput: bgm, master, duck, buses: { sfx, bgm, lead } };
}

/**
 * 音のまとまり。1 回のプレイが鳴らす音をまとめておき、プレイを捨てるときに残響ごと止める。
 * AudioEngine.createGroup() で作る。
 */
export class VoiceGroup {
  private readonly stopFn: (group: VoiceGroup, fadeSeconds: number) => void;
  private readonly sizeFn: (group: VoiceGroup) => number;

  constructor(stop: (group: VoiceGroup, fadeSeconds: number) => void, size: (group: VoiceGroup) => number) {
    this.stopFn = stop;
    this.sizeFn = size;
  }

  /** このまとまりの音を fadeSeconds 秒でフェードアウトさせて止める。まだ鳴り始めていない予約も鳴らさない */
  stopAll(fadeSeconds: number): void {
    this.stopFn(this, fadeSeconds);
  }

  /** 鳴っている（または予約されている）音の数 */
  get size(): number {
    return this.sizeFn(this);
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
 */
export class AudioEngine {
  private built: Graph | null = null;
  private readonly createContext: () => AudioContext | null;
  private unlocked = false;
  private readonly voices: Record<Bus, VoiceState[]> = { sfx: [], bgm: [], lead: [] };
  /** 奪われたり止められたりして、フェードアウト中の音。枠は数えない */
  private readonly releasing: VoiceState[] = [];
  private silenceId = 0;
  private needsResume = false;
  private hidden = false;
  private readonly fallbackOrigin = typeof performance !== 'undefined' ? performance.now() : 0;

  /** @param createContext AudioContext を作る。作れない環境では null を返す */
  constructor(createContext: () => AudioContext | null = defaultContext) {
    this.createContext = createContext;
    if (typeof window === 'undefined') return;
    settings.subscribe(() => this.applySettings());
    document.addEventListener('visibilitychange', this.onVisibility);
    // 中断（通話など）や復帰に失敗したあとは、次のユーザー操作で再開を試みる
    const retry = () => {
      const ctx = this.built?.ctx;
      if (this.needsResume || (ctx && ctx.state !== 'running' && !this.hidden)) void this.resume();
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
    return new VoiceGroup(this.stopGroup, this.groupSize);
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
   * 効果音と BGM を duration 秒だけ無音にしてから fadeIn 秒で戻す。lead の音だけが聞こえる状態になる。
   */
  silence(duration: number, fadeIn = 0.02): SilenceHandle {
    const graph = this.built;
    if (!graph) return NOOP_SILENCE;
    const ctx = graph.ctx;
    const t = ctx.currentTime;
    const g = graph.duck.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + DUCK_FADE);
    g.setValueAtTime(0, t + duration);
    g.linearRampToValueAtTime(1, t + duration + fadeIn);
    const id = ++this.silenceId;
    return {
      cancel: () => {
        if (id !== this.silenceId) return;
        const now = ctx.currentTime;
        g.cancelScheduledValues(now);
        g.setValueAtTime(1, now);
      },
    };
  }

  /** AudioContext とバスを作る。作れない環境では null */
  private ensureGraph(): Graph | null {
    if (this.built) return this.built;
    const ctx = this.createContext();
    if (!ctx) return null;
    const graph = buildGraph(ctx);
    this.built = graph;
    ctx.addEventListener('statechange', () => {
      if (ctx.state !== 'running' && !this.hidden) this.needsResume = true;
    });
    this.applySettings();
    return graph;
  }

  private applySettings(): void {
    const g = this.built;
    if (!g) return;
    const s = settings.get();
    const t = g.ctx.currentTime;
    // 音量は知覚に合わせて 2 乗のカーブにする。オフは 0
    const sfx = s.sfx ? VOLUME_SFX * VOLUME_SFX : 0;
    g.master.gain.setTargetAtTime(VOLUME_MASTER * VOLUME_MASTER, t, 0.02);
    g.buses.sfx.gain.setTargetAtTime(sfx, t, 0.02);
    g.buses.bgm.gain.setTargetAtTime(s.bgm ? VOLUME_BGM * VOLUME_BGM : 0, t, 0.02);
    g.buses.lead.gain.setTargetAtTime(sfx, t, 0.02);
  }

  /** unlock() を呼んだ後だけ動かす。それまではユーザー操作の外で動き出さないようにする */
  private async resume(): Promise<void> {
    const ctx = this.built?.ctx;
    if (!ctx || this.hidden || !this.unlocked) return;
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
    const end = now + fade;
    const g = v.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, end);
    for (const s of v.sources) {
      try {
        s.stop(end);
      } catch {
        // すでに止まった音源は無視する
      }
    }
    if (v.end > end) v.end = end;
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

  private readonly groupSize = (group: VoiceGroup): number => {
    let n = 0;
    for (const bus of BUSES) {
      for (const v of this.voices[bus]) if (v.group === group) n++;
    }
    return n;
  };
}

const BUSES: readonly Bus[] = ['sfx', 'bgm', 'lead'];

/** 鳴り終わった voice を切り離して取り除く。順番（古い順）は保つ */
function reapPool(pool: VoiceState[], now: number): void {
  let w = 0;
  for (let r = 0; r < pool.length; r++) {
    const v = pool[r];
    if (v.end + REAP_MARGIN < now) v.out.disconnect();
    else pool[w++] = v;
  }
  pool.length = w;
}

export const audio = new AudioEngine();
