import type { ParticleSpec } from '../../../engine/particle-spec.ts';
import { CameraRig } from '../../../juice/camera.ts';
import { FlashLimiter } from '../../../juice/flash.ts';
import type { FrameTime } from '../../../juice/frame-time.ts';
import { WorldClock } from '../../../juice/time.ts';
import { feverLevel } from '../combo.ts';
import { CAMERA_RIG } from '../config.ts';
import { Match } from '../match.ts';
import type { Position } from '../rules/position.ts';
import { ScoreKeeper } from '../scoring.ts';
import { StableTracker } from '../stable-tracker.ts';
import type { Callout, HudState, MatchSetup, Side } from '../types.ts';
import type { BgmPort } from './atmosphere.ts';
import { choreograph } from './choreo.ts';
import type { MoveChoreo } from './choreo.ts';
import { Director } from './director.ts';
import type { HumanMove, SfxPort } from './director.ts';
import { DiscField } from './discs.ts';
import { createFxState } from './fx-state.ts';
import type { FxState } from './fx-state.ts';

/** 呼ばれた音・無音・振動・文字・光の許可を、世界時間つきで 1 本の列に記録する */
class Recorder {
  readonly log: { name: string; args: unknown[]; world: number }[] = [];
  world = 0;

  record(name: string, args: unknown[]): void {
    this.log.push({ name, args, world: this.world });
  }

  /** name の呼び出し（引数を含む） */
  calls(name: string): { args: unknown[]; world: number }[] {
    return this.log.filter((l) => l.name === name);
  }

  count(name: string): number {
    return this.calls(name).length;
  }
}

const SFX_METHODS = [
  'swoosh',
  'gatherLift',
  'vanish',
  'place',
  'flipStep',
  'burst',
  'inhale',
  'dread',
  'corner',
  'stable',
  'combo',
  'comboBreak',
  'score',
  'newBest',
  'pass',
  'nope',
  'introDrop',
  'boardIn',
  'countTick',
  'verdict',
] as const satisfies readonly (keyof SfxPort)[];

/** 呼ばれた効果音を記録する。止められる音（inhale）は、止めたことも sfx.inhale.stop として記録する */
function recordingSfx(rec: Recorder): SfxPort {
  const sfx = {} as Record<(typeof SFX_METHODS)[number], (...args: unknown[]) => unknown>;
  for (const m of SFX_METHODS) sfx[m] = (...args: unknown[]) => rec.record(`sfx.${m}`, args);
  sfx.inhale = (...args: unknown[]) => {
    rec.record('sfx.inhale', args);
    return { stop: () => rec.record('sfx.inhale.stop', []) };
  };
  return sfx as unknown as SfxPort;
}

/** 粒の数を数える出し先 */
class CountingSink {
  count = 0;
  readonly specs: ParticleSpec[] = [];
  emit(_now: number, p: ParticleSpec): void {
    this.count++;
    this.specs.push({ ...p });
  }
}

type KitOptions = {
  setup?: MatchSetup;
  start?: Position;
  /** これまでの最高スコア（省略すると記録なしの 0） */
  bestScore?: number;
};

/** 人の手に添えるコンボ（省略すると、窓の中で打った 1 つ目のコンボ） */
type MoveOptions = { combo?: number; quick?: boolean };

/**
 * 本物の対局・時計・カメラ・確定石の追跡で演出ディレクターを動かし、呼ばれた音や演出を記録する環境。
 * frame() で 60fps の 1 フレームを進める（世界時間はスローモーションで遅くなり、ヒットストップで止まる）。
 * 光の許可（FlashLimiter）の問い合わせは flash.request として、許されたかを添えて記録する
 */
export class DirectorKit {
  readonly rec = new Recorder();
  readonly match: Match;
  readonly clock = new WorldClock();
  readonly camera = new CameraRig(CAMERA_RIG);
  readonly fx: FxState = createFxState();
  readonly discs = new DiscField();
  readonly particles = new CountingSink();
  readonly flashes = new FlashLimiter(3, 1);
  readonly callouts: Callout[] = [];
  readonly director: Director;
  readonly ft: FrameTime = { realDt: 0, worldDt: 0, real: 0, world: 0, present: 0 };
  readonly hud: HudState;
  finished = 0;
  private readonly stable = new StableTracker();
  private readonly score = new ScoreKeeper();

  constructor(opts: KitOptions = {}) {
    const setup = opts.setup ?? { human: 0 };
    this.match = new Match(setup, opts.start);
    const rec = this.rec;
    const bgm: BgmPort = {
      setTier: (t) => rec.record('bgm.setTier', [t]),
      setRiser: (l) => rec.record('bgm.setRiser', [l]),
      beatPosition: () => 0,
    };
    this.director = new Director({
      human: setup.human,
      clock: this.clock,
      camera: this.camera,
      fx: this.fx,
      discs: this.discs,
      bestScore: opts.bestScore ?? 0,
      presentOffset: 0,
      ports: {
        sfx: recordingSfx(rec),
        bgm,
        audio: {
          silence: (d, f, delay) => {
            rec.record('audio.silence', [d, f, delay]);
            return { cancel: () => rec.record('audio.cancelSilence', []) };
          },
        },
        particles: this.particles,
        flashes: {
          request: (now) => {
            const ok = this.flashes.request(now);
            rec.record('flash.request', [ok]);
            return ok;
          },
        },
        vibrate: (p) => rec.record('vibrate', [p]),
        callout: (c) => {
          rec.record('callout', [c]);
          this.callouts.push(c);
        },
      },
    });
    this.hud = {
      runId: 1,
      human: setup.human,
      black: 0,
      white: 0,
      score: 0,
      newBest: false,
      comboWindow: 0,
      fever: 0,
    };
  }

  /** 始まりの演出を始める。演出が終わる世界時間を返す */
  intro(): number {
    const p = this.match.position;
    return this.director.intro(p, this.stable.record(p), this.ft);
  }

  /** 1 フレーム進める */
  frame(dt = 1 / 60): void {
    const ft = this.ft;
    ft.realDt = dt;
    ft.real += dt;
    ft.worldDt = this.clock.advance(dt);
    ft.world += ft.worldDt;
    ft.present = ft.world;
    this.rec.world = ft.world;
    if (this.director.frame(ft, 1)) this.finished++;
    this.director.hud(this.hud);
  }

  /** 世界時間が world を過ぎるまでフレームを進める */
  until(world: number, maxFrames = 60 * 60): void {
    for (let i = 0; i < maxFrames && this.ft.world < world; i++) this.frame();
  }

  /**
   * 手番の側が square に打ち、演出を始める。人の手には、本物の得点の数え方で決めた得点とコンボを添える。
   * 演出が終わる世界時間と時間割を返す
   */
  play(square: number, opts: MoveOptions = {}): { end: number; choreo: MoveChoreo; start: number; human: HumanMove | null } {
    const side: Side = this.match.turn ?? 'human';
    const outcome = this.match.play(square);
    const choreo = choreograph(outcome, side);
    const gained = this.stable.record(outcome.position);
    const start = this.ft.world;
    let human: HumanMove | null = null;
    if (side === 'human') {
      const combo = opts.combo ?? 1;
      const mine = this.match.setup.human === 0 ? gained.black : gained.white;
      const score = this.score.add(outcome, mine.length, combo, opts.quick ?? false);
      human = { combo, fever: feverLevel(combo), score, total: this.score.total };
    }
    const end = this.director.move(outcome, choreo, gained, this.ft, human);
    return { end, choreo, start, human };
  }
}
