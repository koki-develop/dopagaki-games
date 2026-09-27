/** シーケンサーが読む時計。AudioEngine がこの形を満たす */
export type SequencerClock = {
  /** 秒。running の間は AudioContext の時刻、それ以外は実時間 */
  now(): number;
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
/** 鳴らし始め（時計が切り替わったとき）に、最初のステップを置く先の時刻（秒） */
const START_LEAD = 0.06;
/** 止めた位置から再開するとき、最初のステップまでに最低限あける時間（秒） */
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
 */
export class Sequencer {
  readonly bpm: number;
  readonly stepsPerBeat: number;
  private readonly clock: SequencerClock;
  private readonly onStep: (step: number, time: number) => void;
  private readonly timer: IntervalTimer;
  private timerId: unknown = null;
  private nextStep = 0;
  private nextTime = 0;
  /** step 0 の時刻 */
  private origin = 0;
  private usingCtxClock = false;
  /** 止めている間の、次のステップまでの残り時間（秒）。再開するときにこの間合いを保つ */
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

  /** 次に予約されるステップの番号 */
  get upcomingStep(): number {
    return this.nextStep;
  }

  start(): void {
    if (this.playing) return;
    this.anchor(Math.min(LOOKAHEAD + this.stepDuration, Math.max(MIN_LEAD, this.pendingLead)));
    this.timerId = this.timer.set(this.tick, INTERVAL_MS);
    this.tick();
  }

  stop(): void {
    if (!this.playing) return;
    this.timer.clear(this.timerId);
    this.timerId = null;
    this.pendingLead = Math.max(0, this.nextTime - this.clock.now());
  }

  /** ステップ 0 へ戻す。鳴らしている間なら、今からステップ 0 を鳴らし始める */
  reset(): void {
    this.nextStep = 0;
    this.pendingLead = START_LEAD;
    if (this.playing) this.anchor(START_LEAD);
  }

  /** 実際に聞こえている位置（拍単位）。ビートに合わせた映像に使う */
  beatPosition(): number {
    const beat = 60 / this.bpm;
    const latency = this.clock.latency();
    if (!this.playing) return (this.nextStep * this.stepDuration - this.pendingLead - latency) / beat;
    return (this.clock.now() - latency - this.origin) / beat;
  }

  private anchor(lead: number): void {
    this.usingCtxClock = this.clock.running;
    this.nextTime = this.clock.now() + lead;
    this.origin = this.nextTime - this.nextStep * this.stepDuration;
  }

  private readonly tick = (): void => {
    // AudioContext が動き出したり止まったりしたら、時刻の基準が変わるので予約位置を付け直す
    if (this.clock.running !== this.usingCtxClock) this.anchor(START_LEAD);
    const now = this.clock.now();
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
