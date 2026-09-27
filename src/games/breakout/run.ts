import { FixedStepper, MAX_FRAME_DT } from '../../engine/frame-loop.ts';
import type { AudioEngine, VoiceGroup } from '../../juice/audio/engine.ts';
import { CameraRig } from '../../juice/camera.ts';
import type { FlashLimiter } from '../../juice/flash.ts';
import { WorldClock } from '../../juice/time.ts';
import { STEP_DT } from './config.ts';
import type { SimConfig } from './config.ts';
import type { FrameTime } from './frame-time.ts';
import { Director } from './fx/director.ts';
import type { DirectorOutcome, DirectorPorts } from './fx/director.ts';
import { createFxState } from './fx/fx-state.ts';
import type { FxState } from './fx/fx-state.ts';
import { PaddleInput } from './paddle-input.ts';
import { paddleRange, Sim } from './sim/sim.ts';
import type { SimInput } from './sim/sim.ts';
import type { StageDef } from './sim/stage-parse.ts';
import type { Bgm } from './sounds/bgm.ts';
import { BreakoutSfx } from './sounds/sfx.ts';
import type { HudState, RunMode, RunResult } from './types.ts';
import type { SceneSource } from './view/scene.ts';

/** 1 フレームで進める固定ステップの上限。フレーム間隔の上限ぶんで、これを超えた遅れは捨てる（処理落ちで時間が暴走しないように） */
const MAX_STEPS_PER_FRAME = Math.ceil(MAX_FRAME_DT / STEP_DT);
/** run を捨てるときに、鳴っている効果音を消す時間（秒） */
const DISPOSE_FADE = 0.05;

/** セッションが持ち、プレイをまたいで使い回すもの */
export type RunServices = {
  audio: AudioEngine;
  bgm: Bgm;
  flashes: FlashLimiter;
  particles: DirectorPorts['particles'];
  debris: DirectorPorts['debris'];
  vibrate: DirectorPorts['vibrate'];
  /** 今の時刻（秒）。入力の押した時刻（ReleaseInfo.pressedAt）と同じ時間軸 */
  inputNow(): number;
};

type RunOptions = {
  id: number;
  mode: RunMode;
  /** ステージの一覧。mode のステージ番号で引く */
  stages: readonly StageDef[];
  previousBest: number;
  seed: number;
  config: SimConfig;
  /** このプレイが始まったときの present の時刻。present = presentOffset + 世界時間 */
  presentOffset: number;
  services: RunServices;
};

/**
 * プレイの節目。演出ディレクターから届き、セッションがフレームの終わりにここだけを読んで、状態と画面へ反映する。
 * 一度書いた値は変わらない。
 */
type RunSignals = {
  /** 勝敗が決まった時刻（秒、RunServices.inputNow の時間軸）。まだなら NaN */
  endingAt: number;
  /** 結果が確定した。まだなら null */
  finished: RunResult | null;
};

const createHudState = (id: number, maxLives: number): HudState => ({
  runId: id,
  score: 0,
  chain: 0,
  multiplier: 1,
  best: 0,
  newBest: false,
  lives: maxLives,
  maxLives,
});

/**
 * 1 回のプレイ。prepare のたびに作り直し、使い終わったら捨てる。途中の状態を初期値へ戻す操作は持たない。
 * sim・世界の時計・カメラ・演出の状態・効果音・演出ディレクター・固定ステップ・パドルの入力をまとめて持つ。
 */
export class Run implements SceneSource {
  readonly id: number;
  readonly mode: RunMode;
  readonly presentOffset: number;
  readonly sim: Sim;
  readonly camera = new CameraRig({ maxOffset: 0.38, maxRotation: 0.045, decayPerSecond: 1.15, frequency: 18 });
  readonly fx: FxState;
  readonly input: PaddleInput;
  readonly hud: HudState;
  readonly signals: Readonly<RunSignals>;
  private readonly sig: RunSignals = { endingAt: Number.NaN, finished: null };
  private readonly clock = new WorldClock();
  private readonly director: Director;
  private readonly stepper = new FixedStepper(STEP_DT, MAX_STEPS_PER_FRAME);
  private readonly group: VoiceGroup;
  private readonly ft: FrameTime;
  private disposed = false;

  constructor(opts: RunOptions) {
    const { mode, config, services } = opts;
    this.id = opts.id;
    this.mode = mode;
    this.presentOffset = opts.presentOffset;
    this.signals = this.sig;
    const stage = mode.kind === 'stage' ? opts.stages[mode.index] : undefined;
    if (mode.kind === 'stage' && !stage) throw new Error(`unknown stage index ${mode.index}`);
    this.sim = new Sim({ mode: stage ? { kind: 'stage', stage } : { kind: 'endless' }, seed: opts.seed, config });
    this.fx = createFxState(mode.kind === 'endless');
    const { min, max } = paddleRange(config);
    this.input = new PaddleInput(min, max, this.sim.paddleX);
    this.hud = createHudState(opts.id, config.stage.lives);
    this.ft = { realDt: 0, worldDt: 0, real: 0, world: 0, present: opts.presentOffset };
    this.group = services.audio.createGroup();
    const previousBest = opts.previousBest;
    this.director = new Director({
      sim: this.sim,
      clock: this.clock,
      camera: this.camera,
      fx: this.fx,
      previousBest,
      ports: {
        sfx: new BreakoutSfx(services.audio, this.group),
        bgm: services.bgm,
        audio: services.audio,
        particles: services.particles,
        debris: services.debris,
        flashes: services.flashes,
        vibrate: services.vibrate,
      },
      onEnding: () => {
        if (!this.disposed) this.sig.endingAt = services.inputNow();
      },
      onFinished: (o: DirectorOutcome) => {
        if (!this.disposed) this.sig.finished = { mode, cleared: o.cleared, score: o.score, previousBest, newBest: o.newBest };
      },
    });
    this.writeHud();
  }

  /** 最後に advance() したフレームの時刻。世界を進めないフレーム（一時停止中など）の描画にも、この値をそのまま使う */
  get frameTime(): Readonly<FrameTime> {
    return this.ft;
  }

  /** 最後のステップから次のステップまでの位置（0〜1）。描画の補間に使う */
  get alpha(): number {
    return this.stepper.alpha;
  }

  /**
   * 1 フレームぶん世界を進める。
   * @param realDt このフレームの実時間の増分（上限つき、秒）
   * @param real セッションの実時間（秒）
   * @param budget パーティクルの予算（0〜1）
   */
  advance(realDt: number, real: number, budget: number): Readonly<FrameTime> {
    const worldDt = this.clock.advance(realDt);
    const sim = this.sim;
    sim.events.clear();
    this.input.feed(this.stepper.advance(worldDt), this.stepSim);
    const ft = this.ft;
    ft.realDt = realDt;
    ft.worldDt = worldDt;
    ft.real = real;
    ft.world = sim.time + this.stepper.remainder;
    ft.present = this.presentOffset + ft.world;
    this.director.frame(ft, budget);
    this.writeHud();
    return ft;
  }

  /** 勝敗が決まった後のタップ。演出を飛ばせたら true（結果は次の advance を待たずに signals.finished へ入る） */
  skip(): boolean {
    return this.disposed ? false : this.director.skip();
  }

  /** HUD のスコアの位置（ワールド座標）。得点に変わった光はここへ吸い込まれる */
  setScoreAnchor(x: number, y: number): void {
    this.director.setScoreAnchor(x, y);
  }

  /** 捨てる。演出ディレクターを止め、このプレイの効果音を消す。何度呼んでもよい */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.director.dispose();
    this.group.stopAll(DISPOSE_FADE);
  }

  private readonly stepSim = (input: Readonly<SimInput>): void => {
    this.sim.step(input);
  };

  private writeHud(): void {
    this.director.hud(this.hud);
  }
}
