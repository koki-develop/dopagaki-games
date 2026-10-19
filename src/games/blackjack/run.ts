import type { ParticleSink } from '../../engine/particle-spec.ts';
import type { LayeredBgm } from '../../juice/audio/bgm.ts';
import type { AudioEngine, VoiceGroup } from '../../juice/audio/engine.ts';
import { CameraRig } from '../../juice/camera.ts';
import type { FlashLimiter } from '../../juice/flash.ts';
import type { FrameTime } from '../../juice/frame-time.ts';
import { WorldClock } from '../../juice/time.ts';
import { Rng } from '../../shared/rng.ts';
import { CAMERA_RIG, INPUT_BUFFER } from './config.ts';
import { CardField } from './fx/cards.ts';
import { ChipField } from './fx/chips.ts';
import { Director } from './fx/director.ts';
import type { PxProjector } from './fx/director.ts';
import { createFxState } from './fx/fx-state.ts';
import type { FxState } from './fx/fx-state.ts';
import type { Card } from './rules/cards.ts';
import { Fortune } from './rules/fortune.ts';
import type { BetChip } from './denominations.ts';
import { ACTIONS, MAX_HANDS } from './rules/round.ts';
import type { Action, Round } from './rules/round.ts';
import { Shoe } from './rules/shoe.ts';
import { betLimit, FIRST_BET, fitBet, MIN_BET, ROUNDS, START_CHIPS } from './scoring.ts';
import { BlackjackSfx } from './sounds/sfx.ts';
import { Table } from './table.ts';
import type { BetLabel, Callout, HandLabel, HudState, Outcome, RunResult } from './types.ts';

/** run を捨てるときに、鳴っている効果音を消す時間（秒） */
const DISPOSE_FADE = 0.05;

/** セッションが持ち、プレイをまたいで使い回すもの */
export type RunServices = {
  audio: AudioEngine;
  bgm: LayeredBgm;
  flashes: FlashLimiter;
  particles: ParticleSink;
  vibrate(pattern: number | readonly number[]): void;
  /** 卓の上に文字を出す（位置はワールド座標） */
  callout(c: Callout): void;
  /** スクリーンリーダーに読み上げさせる */
  announce(text: string): void;
  /** 今の時刻（秒）。入力の押した時刻と同じ時間軸 */
  inputNow(): number;
  /** ワールド座標を CSS ピクセルへ直す（HUD の合計の札の位置） */
  px: PxProjector;
};

type RunOptions = {
  id: number;
  /** シューの先頭に置くカード。開発用の操作口だけが渡し、渡したプレイは練習として記録に残さない。null なら混ぜたシュー */
  top: readonly Card[] | null;
  /** これまでの最高スコア（記録がなければ 0） */
  bestScore: number;
  seed: number;
  /** このプレイが始まったときのセッションの実時間（秒）と、present の時刻。present = presentOffset + 世界時間 */
  real: number;
  presentOffset: number;
  services: RunServices;
};

/**
 * プレイの段階。
 * - intro: 始まりの演出（until まで）
 * - betting: 次のラウンドの賭けを選んでいる。配るボタンを待つ
 * - busy: 出来事を見せている（until まで）。終われば、操作を待つか、ラウンドを締めるか、次の賭けを選ぶ
 * - deciding: 操作を待っている
 * - ending: 終わりの儀式
 * - done: 結果が確定した
 */
type Stage =
  | { readonly k: 'intro'; readonly until: number }
  | { readonly k: 'betting' }
  | { readonly k: 'busy'; readonly until: number; readonly next: 'decide' | 'settle' | 'bet' }
  | { readonly k: 'deciding' }
  | { readonly k: 'ending' }
  | { readonly k: 'done' };

const DECIDING: Stage = { k: 'deciding' };
const BETTING: Stage = { k: 'betting' };

/** プレイの節目。セッションがフレームの終わりに読み、状態と画面へ反映する。一度書いた値は変わらない */
type RunSignals = {
  /** 儀式を始めた時刻（秒、RunServices.inputNow の時間軸）。まだなら NaN */
  endingAt: number;
  /** 結果が確定した。まだなら null */
  finished: RunResult | null;
};

const hiddenLabel = (): HandLabel => ({ shown: false, total: 0, soft: false, state: 'waiting', x: 0, y: 0 });
const hiddenBet = (): BetLabel => ({ shown: false, amount: 0, crowded: false, x: 0, y: 0, width: 0 });

/**
 * 1 回のプレイ（ROUNDS ラウンド）。start のたびに作り直し、使い終わったら捨てる。途中の状態を初期値へ戻す操作は持たない。
 * 卓（Table）・世界の時計・カメラ・演出の状態・カードとチップの見た目・効果音・演出ディレクターをまとめて持つ。
 * 規則の進行は操作の時点で Table が決め、ディレクターがそれを時間をかけて見せる。見せ終えるまで、次の操作は受け付けない。
 * ラウンドの前には賭けを選ぶ。前のラウンドの賭けを、今の手持ちで賭けられる値に収めて置いておく（最初は FIRST_BET）。
 */
export class Run {
  readonly id: number;
  readonly table: Table;
  readonly camera = new CameraRig(CAMERA_RIG);
  readonly fx: FxState = createFxState();
  readonly cards = new CardField();
  readonly chips = new ChipField();
  readonly hud: HudState;
  readonly signals: Readonly<RunSignals>;
  private readonly sig: RunSignals = { endingAt: Number.NaN, finished: null };
  private readonly presentOffset: number;
  private readonly practice: boolean;
  private readonly bestScore: number;
  private readonly clock = new WorldClock();
  private readonly director: Director;
  private readonly services: RunServices;
  private readonly group: VoiceGroup;
  private readonly ft: FrameTime;
  private stage: Stage;
  /** 操作を待つ直前に押した操作（先行入力）。待ち始めたら選ぶ */
  private buffered: Action | null = null;
  /** 置いている賭け。賭けを選んでいる間に変わり、配ったらそのまま次のラウンドの初めの値になる */
  private bet = FIRST_BET;
  private result: RunResult | null = null;
  private disposed = false;

  constructor(opts: RunOptions) {
    this.id = opts.id;
    this.presentOffset = opts.presentOffset;
    this.practice = opts.top !== null;
    this.bestScore = opts.bestScore;
    this.services = opts.services;
    this.signals = this.sig;
    const rng = new Rng(opts.seed);
    // 配るカードを決めた練習のプレイは、決めた順のまま配る
    this.table = opts.top ? new Table(Shoe.withTop(opts.top, rng)) : new Table(Shoe.shuffled(rng), START_CHIPS, new Fortune(rng));
    this.ft = { realDt: 0, worldDt: 0, real: opts.real, world: 0, present: opts.presentOffset };
    this.hud = {
      runId: opts.id,
      chips: this.table.chips,
      newBest: false,
      streak: 0,
      nextMultiplierTenths: 10,
      fever: 0,
      round: 1,
      finalRound: false,
      slip: { open: false, bet: 0, limit: 0 },
      actions: { hit: false, stand: false, double: false, split: false },
      dealer: hiddenLabel(),
      hands: Array.from({ length: MAX_HANDS }, hiddenLabel),
      bets: Array.from({ length: MAX_HANDS }, hiddenBet),
    };
    this.group = opts.services.audio.createGroup();
    const services = opts.services;
    this.director = new Director({
      clock: this.clock,
      camera: this.camera,
      fx: this.fx,
      cards: this.cards,
      chips: this.chips,
      startChips: this.table.chips,
      presentOffset: opts.presentOffset,
      ports: {
        sfx: new BlackjackSfx(services.audio, this.group),
        bgm: services.bgm,
        audio: services.audio,
        particles: services.particles,
        flashes: services.flashes,
        vibrate: (p) => services.vibrate(p),
        callout: (c) => {
          if (!this.disposed) services.callout(c);
        },
        announce: (text) => {
          if (!this.disposed) services.announce(text);
        },
      },
    });
    this.stage = { k: 'intro', until: this.director.intro(this.ft) };
    this.writeHud();
  }

  /** 最後に advance() したフレームの時刻。世界を進めないフレーム（一時停止中など）の描画にも、この値をそのまま使う */
  get frameTime(): Readonly<FrameTime> {
    return this.ft;
  }

  /** 操作を待っているか */
  get deciding(): boolean {
    return this.stage.k === 'deciding';
  }

  /** 賭けを選んでいるか */
  get betting(): boolean {
    return this.stage.k === 'betting';
  }

  /** 今のラウンド（開発用の自動操作が読む） */
  get round(): Round | null {
    return this.table.round;
  }

  /**
   * 1 フレームぶん進める。
   * @param realDt このフレームの実時間の増分（上限つき、秒）
   * @param real セッションの実時間（秒）
   * @param budget パーティクルの予算（0〜1）
   */
  advance(realDt: number, real: number, budget: number): Readonly<FrameTime> {
    const worldDt = this.clock.advance(realDt);
    const ft = this.ft;
    ft.realDt = realDt;
    ft.worldDt = worldDt;
    ft.real = real;
    ft.world += worldDt;
    ft.present = this.presentOffset + ft.world;
    this.step(ft);
    if (this.director.frame(ft, budget) && this.stage.k === 'ending') this.finish();
    this.writeHud();
    return ft;
  }

  // ---- 人の入力（フレームの外で届く） ----

  /**
   * 操作のボタン。操作を待っていれば選ぶ（選べない操作は鈍い音で知らせる）。
   * 出来事を見せている間は、操作を待ち始めるまでの残りが INPUT_BUFFER 以内なら覚えておき、待ち始めたら選ぶ。それ以外は黙って捨てる。
   * 見せている間に、押した操作への返り方（覚える・鈍い音）を変えると、まだ見せていない結果（バーストやディーラーのブラックジャックで
   * 操作を待たずに精算へ進むか）を先に漏らすので、見せている間は鈍い音を鳴らさない。選んだか、覚えたら true
   */
  act(action: Action): boolean {
    if (this.disposed) return false;
    const s = this.stage;
    if (s.k === 'deciding') return this.choose(action);
    if (s.k === 'busy' && s.next === 'decide' && s.until - this.ft.world <= INPUT_BUFFER) {
      this.buffered = action;
      return true;
    }
    return false;
  }

  /**
   * 賭けにチップを 1 枚足す。上限を超える分は上限で止める（上限に届いていたら鈍い音）。
   * 賭けを選んでいないときは黙って捨てる。足せたら true
   */
  placeChip(value: BetChip): boolean {
    if (this.disposed || this.stage.k !== 'betting') return false;
    const limit = betLimit(this.table.chips);
    if (this.bet >= limit) {
      this.director.rejected();
      return false;
    }
    this.setBet(Math.min(limit, this.bet + value));
    return true;
  }

  /** 手持ちをすべて賭ける（BET_STEP の倍数に切り捨てた額）。すでにすべて賭けていれば鈍い音。賭けを選んでいないときは黙って捨てる。賭けを変えたら true */
  allIn(): boolean {
    if (this.disposed || this.stage.k !== 'betting') return false;
    const limit = betLimit(this.table.chips);
    if (this.bet >= limit) {
      this.director.rejected();
      return false;
    }
    this.setBet(limit);
    return true;
  }

  /** 賭けを取り消して、チップを手持ちへ戻す。何も置いていなければ鈍い音。賭けを選んでいないときは黙って捨てる */
  clearBet(): boolean {
    if (this.disposed || this.stage.k !== 'betting') return false;
    if (this.bet === 0) {
      this.director.rejected();
      return false;
    }
    this.setBet(0);
    return true;
  }

  /** 置いている賭けで配る。賭けが足りなければ鈍い音。賭けを選んでいないときは黙って捨てる。配れたら true */
  deal(): boolean {
    if (this.disposed || this.stage.k !== 'betting') return false;
    if (this.bet < MIN_BET) {
      this.director.rejected();
      return false;
    }
    this.dealRound(this.ft);
    return true;
  }

  private setBet(bet: number): void {
    this.bet = bet;
    this.director.setBet(bet, this.ft);
    this.writeHud();
  }

  /** 操作を待っている手で action を選ぶ。選べなければ鈍い音で知らせる */
  private choose(action: Action): boolean {
    const r = this.table.round;
    if (this.stage.k !== 'deciding' || !r || !r.can(action)) {
      this.director.rejected();
      return false;
    }
    this.table.act(action);
    const until = this.director.play(r, this.ft);
    this.stage = { k: 'busy', until, next: r.finished ? 'settle' : 'decide' };
    this.writeHud();
    return true;
  }

  /** 終わりの儀式をタップで飛ばす。飛ばせたら true（結果は次の advance を待たずに signals.finished へ入る） */
  skip(): boolean {
    if (this.disposed || this.stage.k !== 'ending') return false;
    if (!this.director.skip()) return false;
    this.finish();
    return true;
  }

  /** 捨てる。演出ディレクターを止め、このプレイの効果音を消す。何度呼んでもよい */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.director.dispose();
    this.group.stopAll(DISPOSE_FADE);
  }

  // ---- 進行 ----

  private step(ft: FrameTime): void {
    const s = this.stage;
    switch (s.k) {
      case 'intro':
        if (ft.world >= s.until) this.openBetting(ft);
        return;
      case 'busy':
        if (ft.world < s.until) return;
        if (s.next === 'decide') this.decide();
        else if (s.next === 'settle') this.settle(ft);
        else this.openBetting(ft);
        return;
      case 'betting':
      case 'deciding':
      case 'ending':
      case 'done':
        return;
    }
  }

  /** 操作を待ち始める。先行入力があれば、すぐに選ぶ */
  private decide(): void {
    this.stage = DECIDING;
    const a = this.buffered;
    this.buffered = null;
    if (a) this.choose(a);
  }

  /**
   * 次のラウンドの賭けを選び始める。前の賭けを今の手持ちで賭けられる値に収めて置く。
   * 配れなければ（最後のラウンドを終えたか、破産した）終わりの儀式へ
   */
  private openBetting(ft: FrameTime): void {
    const table = this.table;
    if (!table.canDeal) {
      this.startEnding(ft);
      return;
    }
    this.stage = BETTING;
    this.bet = fitBet(this.bet, table.chips);
    this.director.openBetting(this.bet, table.rounds + 1 === ROUNDS, ft);
    this.writeHud();
  }

  /** 置いている賭けでラウンドを配る */
  private dealRound(ft: FrameTime): void {
    const table = this.table;
    const shoe = Int32Array.from(table.shoe.remainingByPoint);
    const chipsBefore = table.chips;
    const r = table.deal(this.bet);
    const until = this.director.dealRound(r, shoe, chipsBefore, ft);
    this.stage = { k: 'busy', until, next: r.finished ? 'settle' : 'decide' };
    this.writeHud();
  }

  /** ラウンドを精算し、締めの演出を始める */
  private settle(ft: FrameTime): void {
    const s = this.table.settle();
    const until = this.director.roundEnd(s, ft);
    this.stage = { k: 'busy', until, next: 'bet' };
  }

  /** 終わった。結果を決め、終わりの儀式を始める */
  private startEnding(ft: FrameTime): void {
    const table = this.table;
    const score = table.sheet();
    const outcome: Outcome = table.broke ? 'broke' : score.total > score.start ? 'profit' : score.total === score.start ? 'even' : 'loss';
    const result: RunResult = {
      outcome,
      rounds: table.rounds,
      blackjacks: table.blackjacks,
      maxStreak: table.streak.best,
      score,
      previousBest: this.bestScore,
      newBest: this.bestScore > 0 && score.total > this.bestScore,
      practice: this.practice,
    };
    this.result = result;
    this.director.ending(result, ft);
    this.stage = { k: 'ending' };
    this.sig.endingAt = this.services.inputNow();
    const text = { profit: '手持ちを増やして終えました', even: '始めと同じ手持ちで終えました', loss: '手持ちを減らして終えました', broke: '賭けられるチップがなくなりました' }[outcome];
    this.services.announce(`${text}。最後の手持ち ${score.total}`);
  }

  /** 結果が確定した */
  private finish(): void {
    this.stage = { k: 'done' };
    this.sig.finished = this.result;
  }

  private writeHud(): void {
    const h = this.hud;
    const table = this.table;
    this.director.hud(h, this.services.px);
    const r = table.round;
    const stage = this.stage.k;
    const deciding = stage === 'deciding' && r !== null && r.active >= 0;
    for (const a of ACTIONS) h.actions[a] = deciding && r !== null && r.can(a);
    const betting = stage === 'betting';
    h.slip.open = betting;
    h.slip.bet = betting ? this.bet : 0;
    h.slip.limit = betting ? betLimit(table.chips) : 0;
    h.round = Math.min(ROUNDS, table.rounds + (stage === 'intro' || betting ? 1 : 0));
    h.finalRound = h.round === ROUNDS;
  }
}
