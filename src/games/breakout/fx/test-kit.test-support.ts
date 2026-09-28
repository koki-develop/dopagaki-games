/**
 * 演出のテストの道具。本物の Sim・WorldClock・CameraRig・FlashLimiter を使い、音・粒・振動は呼ばれた内容を記録する代役にする。
 * セッションと同じ順序（イベントを消す → 固定ステップを進める → 演出）で 1 フレームずつ進める。
 */
import { CameraRig } from '../../../juice/camera.ts';
import { FlashLimiter } from '../../../juice/flash.ts';
import { WorldClock } from '../../../juice/time.ts';
import { STEP_DT } from '../config.ts';
import type { Tuning } from '../config.ts';
import type { FrameTime } from '../frame-time.ts';
import { cellCenterX } from '../sim/blocks.ts';
import { Sim } from '../sim/sim.ts';
import { emptyRows, line, placeBall, simConfig, stageMode } from '../sim/sim.test-support.ts';
import type { BgmPort } from './atmosphere.ts';
import { Director } from './director.ts';
import type { DirectorOutcome, DirectorPorts } from './director.ts';
import type { FinaleAudio } from './finale.ts';
import { createFxState } from './fx-state.ts';
import type { FxState } from './fx-state.ts';
import type { DebrisSpec, ParticleSpec } from './particle-shape.ts';
import type { SfxPort } from './sound-director.ts';

type Call = { name: string; args: unknown[] };

const SFX_METHODS = [
  'paddle',
  'hardHit',
  'solidHit',
  'breakNote',
  'megaBurst',
  'ballsZero',
  'slam',
  'stepThud',
  'gameOver',
  'peakChord',
  'inhale',
  'finaleBurst',
  'bonusNote',
  'resolveChord',
] as const satisfies readonly (keyof SfxPort)[];

/** 呼ばれた順に全ての音・BGM・振動・無音・コールバックを 1 本の列に記録する */
export class Recorder {
  readonly calls: Call[] = [];

  record(name: string, args: unknown[]): void {
    this.calls.push({ name, args });
  }

  names(from = 0): string[] {
    return this.calls.slice(from).map((c) => c.name);
  }

  count(name: string, from = 0): number {
    let n = 0;
    for (let i = from; i < this.calls.length; i++) if (this.calls[i].name === name) n++;
    return n;
  }

  indexOf(name: string): number {
    return this.calls.findIndex((c) => c.name === name);
  }

  of(name: string): Call[] {
    return this.calls.filter((c) => c.name === name);
  }
}

export function recordingSfx(rec: Recorder): SfxPort {
  const sfx = {} as Record<string, (...args: unknown[]) => void>;
  for (const m of SFX_METHODS) sfx[m] = (...args: unknown[]) => rec.record(`sfx.${m}`, args);
  return sfx as unknown as SfxPort;
}

export function recordingBgm(rec: Recorder): BgmPort & { beat: number } {
  return {
    beat: 0,
    setTier: (t) => rec.record('bgm.setTier', [t]),
    setRiser: (l) => rec.record('bgm.setRiser', [l]),
    setOpenness: (o, s) => rec.record('bgm.setOpenness', [o, s]),
    beatPosition() {
      return this.beat;
    },
  };
}

/** AudioContext の時刻を手で進める代役。running が false なら音は鳴っていない */
class FakeAudio implements FinaleAudio {
  time = 0;
  running = true;
  private readonly rec: Recorder;

  constructor(rec: Recorder) {
    this.rec = rec;
  }

  now(): number {
    return this.time;
  }

  silence(duration: number, fadeIn?: number): { cancel(): void } {
    this.rec.record('audio.silence', [duration, fadeIn]);
    return { cancel: () => this.rec.record('audio.silence.cancel', []) };
  }
}

/** 粒や破片を受け取り、数と、渡された発生条件のオブジェクトの種類を数える */
/** 奈落に落ちたボールとして渡されたもの */
export type FallenBall = { at: number; x: number; y: number; vx: number; vy: number };

export class CountingSink<T extends object> {
  count = 0;
  readonly specs = new Set<T>();
  readonly times: number[] = [];
  /** 渡された値の写し（検査用）。keep を true にしたときだけ残す */
  readonly kept: T[] = [];
  keep = false;

  emit = (now: number, spec: T): void => {
    this.count++;
    this.specs.add(spec);
    this.times.push(now);
    if (this.keep) this.kept.push({ ...spec });
  };
}

/**
 * 1 個のブロックだけのステージ。最初のボールが数ステップで最後のブロックを壊してクリアする。
 * extraBalls 個のボールを、ブロックから離れた下の方に置いておく（クリアの時点で残っているボール）。
 */
export function clearingSim(extraBalls: number, patch?: (t: Tuning) => void): Sim {
  const sim = new Sim({
    mode: stageMode(emptyRows(10).concat([line(2, 'o')])),
    seed: 1,
    config: simConfig((t) => {
      t.blocks.ballsFromBall = 0;
      patch?.(t);
    }),
  });
  placeBall(sim, cellCenterX(2), sim.blocks.centerY(0) - 3, 0, 1);
  for (let k = 0; k < extraBalls; k++) placeBall(sim, 5 + (k % 30) * 0.12, 2.2 + Math.floor(k / 30) * 0.3, 0.3, 1);
  return sim;
}

/** 残機 1 で、ボールが無い（次のステップでゲームオーバーになる）ステージ */
export function losingSim(): Sim {
  return new Sim({
    mode: stageMode(emptyRows(10).concat([line(2, 'o'), line(6, 'o')])),
    seed: 1,
    config: simConfig((t) => {
      t.stage.lives = 1;
    }),
  });
}

type HarnessOptions = {
  sim: Sim;
  previousBest?: number;
  flashes?: FlashLimiter;
  budget?: number;
  /** present と world の差（セッションの中でのプレイの開始時刻） */
  presentOffset?: number;
};

/** セッションと同じ順序で Director を 1 フレームずつ動かす */
export class Harness {
  readonly rec = new Recorder();
  readonly sim: Sim;
  readonly clock = new WorldClock();
  readonly camera = new CameraRig({ maxOffset: 0.3, maxRotation: 0.03, decayPerSecond: 1.2, frequency: 18 });
  readonly fx: FxState;
  readonly audio: FakeAudio;
  readonly bgm: BgmPort & { beat: number };
  readonly particles = new CountingSink<ParticleSpec>();
  readonly debris = new CountingSink<DebrisSpec>();
  readonly fallenBalls: FallenBall[] = [];
  readonly flashes: FlashLimiter;
  readonly director: Director;
  readonly vibrations: (number | readonly number[])[] = [];
  budget: number;
  /** 進めた実時間の合計（秒） */
  real = 0;
  endingAt = -1;
  finishedAt = -1;
  outcome: DirectorOutcome | null = null;
  endings = 0;
  finishes = 0;
  /** 最後に渡した FrameTime */
  readonly ft: FrameTime = { realDt: 0, worldDt: 0, real: 0, world: 0, present: 0 };
  /** 固定ステップを進めた後、演出の前に呼ぶ（イベントを足すなど） */
  beforeDirector: ((sim: Sim) => void) | null = null;
  private accumulator = 0;
  private readonly presentOffset: number;

  constructor(opts: HarnessOptions) {
    this.sim = opts.sim;
    this.budget = opts.budget ?? 1;
    this.presentOffset = opts.presentOffset ?? 100;
    this.fx = createFxState(opts.sim.mode.kind === 'endless', 0.32, 0.22);
    this.audio = new FakeAudio(this.rec);
    this.bgm = recordingBgm(this.rec);
    this.flashes = opts.flashes ?? new FlashLimiter(3, 1);
    const ports: DirectorPorts = {
      sfx: recordingSfx(this.rec),
      bgm: this.bgm,
      audio: this.audio,
      particles: this.particles,
      debris: this.debris,
      fallenBalls: { emit: (at, x, y, vx, vy) => this.fallenBalls.push({ at, x, y, vx, vy }) },
      flashes: this.flashes,
      vibrate: (p) => {
        this.vibrations.push(p);
        this.rec.record('vibrate', [p]);
      },
    };
    this.director = new Director({
      sim: opts.sim,
      clock: this.clock,
      camera: this.camera,
      fx: this.fx,
      ports,
      previousBest: opts.previousBest ?? 0,
      onEnding: () => {
        this.endings++;
        this.endingAt = this.real;
        this.rec.record('onEnding', []);
      },
      onFinished: (o) => {
        this.finishes++;
        this.finishedAt = this.real;
        this.outcome = o;
        this.rec.record('onFinished', [o]);
      },
    });
  }

  /** 勝敗が決まったか（onEnding が届いたか） */
  get ended(): boolean {
    return this.endings > 0;
  }

  /** 最後のフレームの世界時間の倍率 */
  get worldScale(): number {
    return this.ft.realDt > 0 ? this.ft.worldDt / this.ft.realDt : 0;
  }

  /**
   * 実時間 realDt 秒ぶん進める。audioDt は AudioContext の時刻の進み（省略すると realDt と同じ）。
   * 固定ステップの数はセッションと同じく世界時間で決める。
   */
  frame(realDt = 1 / 60, audioDt = realDt): void {
    const worldDt = this.clock.advance(realDt);
    this.real += realDt;
    this.audio.time += audioDt;
    const sim = this.sim;
    sim.events.clear();
    this.accumulator += worldDt;
    let steps = 0;
    while (this.accumulator >= STEP_DT && steps < 12) {
      sim.step({ paddleTargetX: sim.paddleX, launch: false });
      this.accumulator -= STEP_DT;
      steps++;
    }
    if (steps === 12) this.accumulator = 0;
    this.beforeDirector?.(sim);
    const ft = this.ft;
    ft.realDt = realDt;
    ft.worldDt = worldDt;
    ft.real = this.real;
    ft.world = sim.time + this.accumulator;
    ft.present = this.presentOffset + ft.world;
    this.director.frame(ft, this.budget);
  }

  /** cond が真になるまで（最大 maxFrames）進める。進めたフレーム数を返す */
  until(cond: () => boolean, maxFrames = 2000, realDt = 1 / 60): number {
    for (let i = 0; i < maxFrames; i++) {
      if (cond()) return i;
      this.frame(realDt);
    }
    throw new Error('condition not reached');
  }

  run(frames: number, realDt = 1 / 60): void {
    for (let i = 0; i < frames; i++) this.frame(realDt);
  }
}
