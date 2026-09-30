/** シーケンサーが読む時計。AudioEngine がこの形を満たす */
export type SequencerClock = {
  /** 秒。running の間は AudioContext の時刻 */
  now(): number;
  /** 音を鳴らせるか（AudioContext が動いているか） */
  readonly running: boolean;
  /** 予約した時刻から、実際に聞こえるまでの遅れ（秒） */
  latency(): number;
};

/** 一定間隔でコールバックを呼ぶタイマー */
export type IntervalTimer = {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
};

const defaultTimer: IntervalTimer = {
  set: (fn, ms) => setInterval(fn, ms),
  clear: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

/** どこまで先の音を予約しておくか（秒） */
const LOOKAHEAD = 0.12;
const INTERVAL_MS = 25;
/** 鳴らし始めに、最初のステップを置く先の時刻（秒） */
const START_LEAD = 0.06;
/** 止めた位置から続けるとき、最初のステップまでに最低限あける時間（秒） */
const MIN_LEAD = 0.03;
/** これより長く予約が遅れたら、溜まったステップを飛ばして現在から数え直す（秒） */
const MAX_GAP = 0.25;

/**
 * BGM 用のステップシーケンサー。
 * JS のタイマーを 25ms ごとに動かし、時計の時刻を基準に 120ms 先までの音を予約する
 * （「A tale of two clocks」の方式）。
 *
 * - 予約の時刻がすでに過ぎたステップは鳴らさずに飛ばす。タイマーが遅れても、溜まった音をまとめて鳴らさない
 * - 止めて再開すると、止めたステップから同じ間合いで続ける。beatPosition() は止めている間は止まり、再開後もつながる
 * - 時計が動いていない（AudioContext が止まっている）間は、ステップを進めずに待ち、動き出したらそのステップから続ける。
 *   鳴らせないまま曲の頭を読み飛ばさないように。beatPosition() も待っている間は止まる
 */
export class Sequencer {
  readonly bpm: number;
  readonly stepsPerBeat: number;
  private readonly clock: SequencerClock;
  private readonly onStep: (step: number, time: number) => void;
  private readonly timer: IntervalTimer;
  private timerId: unknown = null;
  /** 鳴らしているが、時計が動くのを待っている */
  private waiting = false;
  /**
   * 鳴らしている途中で時計が止まって待っている。AudioContext の時刻は止まっている間は進まず、
   * 予約済みの音は動き出してから元の時刻に鳴るので、動き出したら同じ時間軸のまま続ける
   */
  private frozen = false;
  private nextStep = 0;
  private nextTime = 0;
  /** step 0 の時刻 */
  private origin = 0;
  /** 止めている（待っている）間の、次のステップまでの残り時間（秒）。続けるときにこの間合いを保つ */
  private pendingLead = START_LEAD;

  constructor(
    clock: SequencerClock,
    bpm: number,
    stepsPerBeat: number,
    onStep: (step: number, time: number) => void,
    timer: IntervalTimer = defaultTimer,
  ) {
    this.clock = clock;
    this.bpm = bpm;
    this.stepsPerBeat = stepsPerBeat;
    this.onStep = onStep;
    this.timer = timer;
  }

  get stepDuration(): number {
    return 60 / this.bpm / this.stepsPerBeat;
  }

  get playing(): boolean {
    return this.timerId !== null;
  }

  start(): void {
    if (this.playing) return;
    this.waiting = true;
    this.frozen = false;
    this.timerId = this.timer.set(this.tick, INTERVAL_MS);
    this.tick();
  }

  stop(): void {
    if (!this.playing) return;
    this.timer.clear(this.timerId);
    this.timerId = null;
    this.hold();
    this.frozen = false;
  }

  /** ステップ 0 へ戻す。鳴らしている間なら、今からステップ 0 を鳴らし始める */
  reset(): void {
    this.nextStep = 0;
    this.pendingLead = START_LEAD;
    this.frozen = false;
    if (this.playing && !this.waiting) this.anchor(START_LEAD);
  }

  /** 実際に聞こえている位置（拍単位）。ビートに合わせた映像に使う */
  beatPosition(): number {
    const beat = 60 / this.bpm;
    const latency = this.clock.latency();
    if (!this.playing || this.waiting) return (this.nextStep * this.stepDuration - this.pendingLead - latency) / beat;
    return (this.clock.now() - latency - this.origin) / beat;
  }

  /** 進めるのをやめ、次のステップまでの間合いを覚えておく */
  private hold(): void {
    if (this.waiting) return;
    this.waiting = true;
    this.pendingLead = Math.max(0, this.nextTime - this.clock.now());
  }

  private anchor(lead: number): void {
    this.nextTime = this.clock.now() + lead;
    this.origin = this.nextTime - this.nextStep * this.stepDuration;
  }

  private readonly tick = (): void => {
    if (!this.clock.running) {
      if (!this.waiting) {
        this.hold();
        this.frozen = true;
      }
      return;
    }
    const now = this.clock.now();
    if (this.waiting) {
      this.waiting = false;
      const keep = this.frozen && this.nextTime >= now + MIN_LEAD;
      this.frozen = false;
      if (!keep) this.anchor(Math.min(LOOKAHEAD + this.stepDuration, Math.max(MIN_LEAD, this.pendingLead)));
    }
    // 長く止まっていた（タブが隠れていた等）ときは、溜まったステップを数えずに現在へ飛ぶ
    if (this.nextTime < now - MAX_GAP) this.anchor(START_LEAD);
    const step = this.stepDuration;
    while (this.nextTime < now + LOOKAHEAD) {
      if (this.nextTime >= now) this.onStep(this.nextStep, this.nextTime);
      this.nextStep++;
      this.nextTime += step;
    }
  };
}
