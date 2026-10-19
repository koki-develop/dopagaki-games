import type { ParticleSpec } from '../../../engine/particle-spec.ts';
import { CameraRig } from '../../../juice/camera.ts';
import { FlashLimiter } from '../../../juice/flash.ts';
import type { FrameTime } from '../../../juice/frame-time.ts';
import { WorldClock } from '../../../juice/time.ts';
import { Rng } from '../../../shared/rng.ts';
import { CAMERA_RIG } from '../config.ts';
import { parseCard } from '../rules/cards.ts';
import type { Action } from '../rules/round.ts';
import { DECKS, Shoe } from '../rules/shoe.ts';
import { ROUNDS } from '../scoring.ts';
import { Table } from '../table.ts';
import type { RoundSettlement } from '../table.ts';
import type { BetLabel, Callout, HandLabel, HudState } from '../types.ts';
import type { BgmPort } from './atmosphere.ts';
import { CardField } from './cards.ts';
import { ChipField } from './chips.ts';
import { Director } from './director.ts';
import type { SfxPort } from './director.ts';
import { createFxState } from './fx-state.ts';
import type { FxState } from './fx-state.ts';

/** 呼ばれた音・無音・振動・文字・光の許可を、世界時間つきで 1 本の列に記録する */
class Recorder {
  readonly log: { name: string; args: unknown[]; world: number }[] = [];
  world = 0;

  record(name: string, args: unknown[]): void {
    this.log.push({ name, args, world: this.world });
  }

  calls(name: string): { args: unknown[]; world: number }[] {
    return this.log.filter((l) => l.name === name);
  }

  count(name: string): number {
    return this.calls(name).length;
  }
}

const SFX_METHODS = [
  'deal',
  'land',
  'flip',
  'drumRoll',
  'peek',
  'chip',
  'coin',
  'stand',
  'split',
  'double',
  'bust',
  'twentyOne',
  'blackjack',
  'dealerBust',
  'dealerBlackjack',
  'win',
  'lose',
  'push',
  'streak',
  'streakBreak',
  'finalRound',
  'reshuffle',
  'nope',
  'sweep',
  'tableIn',
  'newBest',
  'verdict',
] as const satisfies readonly (keyof SfxPort)[];

function recordingSfx(rec: Recorder): SfxPort {
  const sfx = {} as Record<(typeof SFX_METHODS)[number], (...args: unknown[]) => unknown>;
  for (const m of SFX_METHODS) sfx[m] = (...args: unknown[]) => rec.record(`sfx.${m}`, args);
  sfx.drumRoll = (...args: unknown[]) => {
    rec.record('sfx.drumRoll', args);
    return { stop: () => rec.record('sfx.drumRoll.stop', []) };
  };
  return sfx as unknown as SfxPort;
}

/** 粒の数と色を数える出し先 */
class CountingSink {
  readonly specs: ParticleSpec[] = [];
  emit(_now: number, p: ParticleSpec): void {
    this.specs.push({ ...p });
  }
}

const hiddenLabel = (): HandLabel => ({ shown: false, total: 0, soft: false, state: 'waiting', x: 0, y: 0 });
const hiddenBet = (): BetLabel => ({ shown: false, amount: 0, crowded: false, x: 0, y: 0, width: 0 });

/** 賭けを決めずに配るときの賭け */
export const KIT_BET = 100;

/**
 * 決められた順に配るシューで、本物の卓と演出ディレクターを動かし、呼ばれた音や演出を記録する環境。
 * fullShoe なら、決めたカードを先頭に置いた 2 組のシューにする（残りは混ぜる）。確率から決まる演出を確かめるときに使う
 */
export class DirectorKit {
  readonly rec = new Recorder();
  readonly table: Table;
  readonly clock = new WorldClock();
  readonly camera = new CameraRig(CAMERA_RIG);
  readonly fx: FxState = createFxState();
  readonly cards = new CardField();
  readonly chips = new ChipField();
  readonly particles = new CountingSink();
  readonly flashes = new FlashLimiter(3, 1);
  readonly callouts: Callout[] = [];
  readonly director: Director;
  readonly ft: FrameTime = { realDt: 0, worldDt: 0, real: 0, world: 0, present: 0 };
  readonly hud: HudState;
  settlements: RoundSettlement[] = [];

  constructor(order: readonly string[], opts: { chips?: number; fullShoe?: boolean } = {}) {
    const cards = order.map(parseCard);
    const shoe = opts.fullShoe ? Shoe.withTop(cards, new Rng(1), DECKS) : Shoe.ofOrder(cards);
    this.table = new Table(shoe, opts.chips);
    const rec = this.rec;
    const bgm: BgmPort = { setTier: (tier) => rec.record('bgm.setTier', [tier]), setRiser: (level) => rec.record('bgm.setRiser', [level]), beatPosition: () => 0 };
    this.director = new Director({
      clock: this.clock,
      camera: this.camera,
      fx: this.fx,
      cards: this.cards,
      chips: this.chips,
      startChips: this.table.chips,
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
        announce: (text) => rec.record('announce', [text]),
      },
    });
    this.hud = {
      runId: 1,
      chips: 0,
      newBest: false,
      streak: 0,
      nextMultiplierTenths: 10,
      fever: 0,
      round: 1,
      finalRound: false,
      slip: { open: false, bet: 0, limit: 0 },
      actions: { hit: false, stand: false, double: false, split: false },
      dealer: hiddenLabel(),
      hands: [hiddenLabel(), hiddenLabel(), hiddenLabel(), hiddenLabel()],
      bets: [hiddenBet(), hiddenBet(), hiddenBet(), hiddenBet()],
    };
  }

  /** 1 フレーム進める */
  /** これまでのフレームでいちばん強かった絞り込み（大きな溜めが起きたか） */
  maxFocus = 0;

  frame(dt = 1 / 60): void {
    const ft = this.ft;
    ft.realDt = dt;
    ft.real += dt;
    ft.worldDt = this.clock.advance(dt);
    ft.world += ft.worldDt;
    ft.present = ft.world;
    this.rec.world = ft.world;
    this.director.frame(ft, 1);
    this.director.hud(this.hud, { x: (x) => x, y: (y) => y });
    this.maxFocus = Math.max(this.maxFocus, this.fx.focus);
  }

  /** 世界時間が world を過ぎるまでフレームを進める */
  until(world: number, maxFrames = 60 * 120): void {
    for (let i = 0; i < maxFrames && this.ft.world < world; i++) this.frame();
  }

  /** 次のラウンドの賭けを bet で選び始める（チップを手持ちから賭けの丸へ置く） */
  openBetting(bet = KIT_BET): void {
    this.director.openBetting(bet, this.table.rounds + 1 === ROUNDS, this.ft);
  }

  /** 賭けを選び始めて bet で配り、出来事を見せ終えるまで進める */
  deal(bet = KIT_BET): void {
    this.openBetting(bet);
    this.until(this.ft.world + 0.4);
    const shoe = Int32Array.from(this.table.shoe.remainingByPoint);
    const chipsBefore = this.table.chips;
    const r = this.table.deal(bet);
    this.until(this.director.dealRound(r, shoe, chipsBefore, this.ft));
  }

  /** 操作を選び、見せ終えるまで進める。ラウンドが終わったら精算して締めまで進める */
  act(action: Action): void {
    const r = this.table.round;
    if (!r) throw new Error('no round');
    this.table.act(action);
    this.until(this.director.play(r, this.ft));
  }

  /** 終わったラウンドを精算し、締めの演出を見せ終えるまで進める */
  settle(): RoundSettlement {
    const s = this.table.settle();
    this.settlements.push(s);
    this.until(this.director.roundEnd(s, this.ft));
    return s;
  }
}
