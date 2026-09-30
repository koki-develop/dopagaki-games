/**
 * テスト用の AudioContext の代役。音は出さず、作ったノードの数、接続、AudioParam の予約、音源の start/stop を記録する。
 */

type ParamEvent =
  | { kind: 'set'; value: number; time: number }
  | { kind: 'linear'; value: number; time: number }
  | { kind: 'exponential'; value: number; time: number }
  | { kind: 'target'; value: number; time: number; tau: number }
  | { kind: 'cancel'; time: number };

export class MockParam {
  readonly events: ParamEvent[] = [];
  /** value で読む値。setValueAtTime でも変わる */
  private current: number;
  /** value へ直接書いた値。予約より前の値として valueAt が使う */
  private base: number;

  constructor(value = 0) {
    this.current = value;
    this.base = value;
  }

  get value(): number {
    return this.current;
  }

  set value(v: number) {
    this.current = v;
    this.base = v;
  }

  setValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'set', value, time });
    this.current = value;
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'exponential', value, time });
    return this;
  }

  setTargetAtTime(value: number, time: number, tau: number): this {
    this.events.push({ kind: 'target', value, time, tau });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.events.push({ kind: 'cancel', time });
    return this;
  }

  /**
   * 時刻 t の値。予約を Web Audio と同じ規則で並べて求める（cancel はそれより後の予約を消す）。
   * setTargetAtTime は扱わず、その予約の手前の値のままとする
   */
  valueAt(t: number): number {
    const kept: Exclude<ParamEvent, { kind: 'cancel' }>[] = [];
    for (const e of this.events) {
      if (e.kind === 'cancel') {
        for (let i = kept.length - 1; i >= 0; i--) if (kept[i].time >= e.time) kept.splice(i, 1);
      } else {
        kept.push(e);
      }
    }
    kept.sort((a, b) => a.time - b.time);
    let v = this.base;
    let at = 0;
    for (const e of kept) {
      if (e.time > t) {
        if (e.kind === 'linear') return v + ((e.value - v) * (t - at)) / (e.time - at);
        if (e.kind === 'exponential') return v * (e.value / v) ** ((t - at) / (e.time - at));
        return v;
      }
      if (e.kind !== 'target') v = e.value;
      at = e.time;
    }
    return v;
  }

  /** 最後に予約された値（ramp / target / set の行き先） */
  get lastTarget(): number | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e.kind !== 'cancel') return e.value;
    }
    return undefined;
  }
}

class MockNode {
  readonly kind: string;
  outputs: MockNode[] = [];
  disconnected = false;

  constructor(kind: string) {
    this.kind = kind;
  }

  connect<T>(dest: T): T {
    this.outputs.push(dest as unknown as MockNode);
    return dest;
  }

  disconnect(): void {
    this.outputs = [];
    this.disconnected = true;
  }
}

export class MockGain extends MockNode {
  readonly gain = new MockParam(1);

  constructor() {
    super('gain');
  }
}

export class MockFilter extends MockNode {
  type = 'lowpass';
  readonly frequency = new MockParam(350);
  readonly Q = new MockParam(1);

  constructor() {
    super('biquad');
  }
}

export class MockSource extends MockNode {
  type = 'sine';
  buffer: unknown = null;
  loop = false;
  wave: unknown = null;
  readonly frequency = new MockParam(440);
  readonly detune = new MockParam(0);
  readonly playbackRate = new MockParam(1);
  startAt = -1;
  startOffset = 0;
  onended: (() => void) | null = null;
  /** 最後の stop() の時刻（Web Audio と同じく、最後の呼び出しだけが効く） */
  stopAt = Infinity;
  stopCalls = 0;

  setPeriodicWave(wave: unknown): void {
    this.wave = wave;
    this.type = 'custom';
  }

  start(time = 0, offset = 0): void {
    this.startAt = time;
    this.startOffset = offset;
  }

  stop(time = 0): void {
    if (this.startAt < 0) throw new Error('InvalidStateError: stop() before start()');
    this.stopAt = time;
    this.stopCalls++;
  }
}

export type MockPeriodicWave = { real: Float32Array; imag: Float32Array; disableNormalization: boolean };

export class MockAudioContext {
  currentTime = 0;
  state: AudioContextState = 'running';
  sampleRate = 48000;
  baseLatency = 0;
  outputLatency = 0;
  readonly destination = new MockNode('destination');
  /** 作ったノードの数（種類別）。コンプレッサーは数えない */
  readonly created = { gain: 0, oscillator: 0, bufferSource: 0, biquad: 0, waveShaper: 0 };
  readonly periodicWaves: MockPeriodicWave[] = [];
  readonly sources: MockSource[] = [];
  readonly gains: MockGain[] = [];
  readonly filters: MockFilter[] = [];

  /** 作ったノードの総数 */
  get nodes(): number {
    const c = this.created;
    return c.gain + c.oscillator + c.bufferSource + c.biquad + c.waveShaper;
  }

  resetCounts(): void {
    this.created.gain = 0;
    this.created.oscillator = 0;
    this.created.bufferSource = 0;
    this.created.biquad = 0;
    this.created.waveShaper = 0;
  }

  createGain(): MockGain {
    this.created.gain++;
    const g = new MockGain();
    this.gains.push(g);
    return g;
  }

  createOscillator(): MockSource {
    this.created.oscillator++;
    const s = new MockSource('oscillator');
    this.sources.push(s);
    return s;
  }

  createBufferSource(): MockSource {
    this.created.bufferSource++;
    const s = new MockSource('bufferSource');
    this.sources.push(s);
    return s;
  }

  createBiquadFilter(): MockFilter {
    this.created.biquad++;
    const f = new MockFilter();
    this.filters.push(f);
    return f;
  }

  createDynamicsCompressor(): MockNode {
    const n = new MockNode('compressor') as MockNode & Record<string, MockParam>;
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new MockParam();
    return n;
  }

  createBuffer(channels: number, length: number, sampleRate: number): { duration: number; numberOfChannels: number; getChannelData(channel: number): Float32Array } {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / sampleRate, numberOfChannels: channels, getChannelData: (channel) => data[channel] };
  }

  createConvolver(): MockNode & { buffer: unknown; normalize: boolean } {
    return Object.assign(new MockNode('convolver'), { buffer: null as unknown, normalize: true });
  }

  createWaveShaper(): MockNode & { curve: Float32Array | null; oversample: string } {
    this.created.waveShaper++;
    return Object.assign(new MockNode('waveShaper'), { curve: null as Float32Array | null, oversample: 'none' });
  }

  createPeriodicWave(real: Float32Array, imag: Float32Array, constraints?: { disableNormalization?: boolean }): MockPeriodicWave {
    const w = { real: real.slice(), imag: imag.slice(), disableNormalization: constraints?.disableNormalization ?? false };
    this.periodicWaves.push(w);
    return w;
  }

  /** resume() を呼んだ回数 */
  resumeCalls = 0;

  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }

  addEventListener(): void {}

  /** AudioContext として渡すための型変換 */
  asContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}
