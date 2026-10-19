import type { ParticleSink } from '../../../engine/particle-spec.ts';
import type { SilenceHandle, SoundHandle } from '../../../juice/audio/engine.ts';
import type { CameraRig } from '../../../juice/camera.ts';
import type { FlashLimiter } from '../../../juice/flash.ts';
import type { FrameTime } from '../../../juice/frame-time.ts';
import type { WorldClock } from '../../../juice/time.ts';
import { CueQueue } from '../../../shared/cue-queue.ts';
import { formatScore, formatSigned } from '../../../shared/format.ts';
import { damp } from '../../../shared/math.ts';
import { ACTION, AIR, BIG_TIER, DEAL, HAPTICS, HIT_STOP, hitStopFor, INTRO, MOTION, PEEK, payoutTier, SETTLE, SHOCKWAVE, SILENCE_DELAY, SLOW_MO, SUMMARY, SUSPENSE } from '../config.ts';
import type { PullTuning } from '../config.ts';
import { CHIP_VALUES, chipShare, chipStack, MAX_STACK, RACK_CAP, RACK_COLUMNS, rackStacks } from '../denominations.ts';
import {
  betLabelPlace,
  betSpot,
  chipPlace,
  DEALER_LABEL,
  DEALER_TRAY,
  DEALER_Y,
  dealerCardPlace,
  COLLECT_CARDS,
  handBounds,
  handCenterX,
  handSlotWidth,
  PLAYER_Y,
  playerCardPlace,
  RACK_H,
  rackPlace,
  playerLabelX,
  playerLabelY,
  SHOE,
  TABLE_W,
} from '../geometry.ts';
import type { CardPlace } from '../geometry.ts';
import { cardName } from '../rules/cards.ts';
import type { Card } from '../rules/cards.ts';
import { handValue } from '../rules/hand.ts';
import { DEALER, MAX_HANDS } from '../rules/round.ts';
import type { Round, RoundEvent } from '../rules/round.ts';
import type { RoundSettlement } from '../table.ts';
import type { BlackjackSfx } from '../sounds/sfx.ts';
import { feverLevel, multiplierTenths } from '../streak.ts';
import type { BetLabel, Callout, HandLabel, HudState, LabelState, RunResult } from '../types.ts';
import { LOOK } from '../view/look.ts';
import { Atmosphere } from './atmosphere.ts';
import type { BgmPort } from './atmosphere.ts';
import { BACK, CardField, CardGlow } from './cards.ts';
import { Ceremony } from './ceremony.ts';
import type { SilencePort } from './ceremony.ts';
import { CHIP_FADE, ChipField, CHIP_SLOTS, RACK_SLOTS } from './chips.ts';
import type { FxState } from './fx-state.ts';
import { ParticleFx } from './particle-fx.ts';
import { TensionMeter } from './tension.ts';

/** 演出から鳴らす効果音。BlackjackSfx がそのまま当てはまる */
export type SfxPort = Pick<
  BlackjackSfx,
  | 'deal'
  | 'land'
  | 'flip'
  | 'drumRoll'
  | 'peek'
  | 'chip'
  | 'coin'
  | 'stand'
  | 'split'
  | 'double'
  | 'bust'
  | 'twentyOne'
  | 'blackjack'
  | 'dealerBust'
  | 'dealerBlackjack'
  | 'win'
  | 'lose'
  | 'push'
  | 'streak'
  | 'streakBreak'
  | 'finalRound'
  | 'reshuffle'
  | 'nope'
  | 'sweep'
  | 'tableIn'
  | 'newBest'
  | 'verdict'
>;

type DirectorPorts = {
  /** 1 回のプレイの効果音（プレイの VoiceGroup に属する） */
  sfx: SfxPort;
  bgm: BgmPort;
  audio: SilencePort;
  /** now は present の時間軸 */
  particles: ParticleSink;
  /** セッションで 1 つ。実時間（FrameTime.real）で問い合わせる */
  flashes: Pick<FlashLimiter, 'request'>;
  vibrate(pattern: number | readonly number[]): void;
  /** 卓の上に文字を出す（位置はワールド座標） */
  callout(c: Callout): void;
  /** スクリーンリーダーに読み上げさせる */
  announce(text: string): void;
};

/** ワールド座標を、描画領域の左上からの CSS ピクセルへ直す（合計の札の位置） */
export type PxProjector = { x(worldX: number): number; y(worldY: number): number };

type DirectorOptions = {
  clock: WorldClock;
  camera: CameraRig;
  fx: FxState;
  cards: CardField;
  chips: ChipField;
  ports: DirectorPorts;
  /** 始めの手持ち */
  startChips: number;
  /** world を present へ直す足し算 */
  presentOffset: number;
};

/**
 * 表になっているカードと、その合計。合計の札は毎フレーム書くので、合計はカードが変わったときにだけ求めておく
 */
type Faces = { readonly cards: Card[]; total: number; soft: boolean };

const emptyFaces = (): Faces => ({ cards: [], total: 0, soft: false });

/** カードを変えた後に、合計を求め直す */
function refresh(f: Faces): void {
  const v = handValue(f.cards);
  f.total = v.total;
  f.soft = v.soft;
}

/**
 * 卓のチップの山 1 つ。額を額面に崩したチップ（denoms、CHIP_VALUES の添字）を下から積む。
 * k 枚目のチップは、チップの枠 base + k に置く（山ごとに MAX_STACK 個の枠を持ち、枠の順に描くので上のチップが上に重なる）
 */
type Stack = { readonly base: number; readonly denoms: number[]; amount: number };

/** 見えている手 1 つ。演出の予定が来たときに書き換える */
type ShownHand = {
  slots: number[];
  /** 表になっているカード（合計の札に出す） */
  faces: Faces;
  doubled: boolean;
  /** 賭けのチップの山と、払い戻しのチップの山 */
  bet: Stack;
  win: Stack;
  state: LabelState;
  /** もう引かずに合計が決まった（止めた・バースト・ブラックジャック・決着）。合計の札に、A を 1 と数えた合計を添えない */
  done: boolean;
};

/** done は、もう引かずに合計が決まったか（合計の札に、A を 1 と数えた合計を添えない） */
type ShownDealer = { slots: number[]; faces: Faces; hole: number; state: LabelState; done: boolean };

/** 予定の 1 件の中身。時刻の来たフレームで呼ぶ */
type CueRun = (ft: FrameTime, budget: number) => void;

const pull = (camera: CameraRig, p: PullTuning): void => camera.pull(p.amount, p.attack, p.release);

/** 手持ちの山に増えたチップを落とす高さ（ワールド単位）と、落ちる長さ、1 枚ごとのずれ（present の秒） */
const RACK_DROP = 0.45;
const RACK_FALL = 0.12;
const RACK_GAP = 0.02;
/** 手持ちの山の列の数が変わったときに、残す列を新しい位置へ滑らせる長さ（present の秒） */
const RACK_SLIDE = 0.2;

/**
 * 作った順が block 番目の手（分けても番号は変わらない）。チップの枠は、手ごとに賭けと払い戻しの 2 つの山の分を持つ
 */
const emptyHand = (block: number): ShownHand => ({
  slots: [],
  faces: emptyFaces(),
  doubled: false,
  bet: { base: RACK_SLOTS + block * 2 * MAX_STACK, denoms: [], amount: 0 },
  win: { base: RACK_SLOTS + (block * 2 + 1) * MAX_STACK, denoms: [], amount: 0 },
  state: 'waiting',
  done: false,
});

/** シューから出てくるカードの、出てくる前の置き場所 */
const FROM_SHOE: CardPlace = { x: SHOE.x, y: SHOE.y, rot: 0.6, scale: 0.8 };

/**
 * 1 回のプレイの演出。ラウンドの出来事（Round.events）を、出てきた順に世界時間の予定（CueQueue）へ並べ、
 * 時刻が来たフレームで、カード（CardField）・チップ（ChipField）・音・粒・カメラ・文字・合計の札を出す。
 * ラウンドの進行は操作の時点で決まっているので、ここはそれを時間をかけて見せるだけで、結果を変えない。
 *
 * - 賭けを選んでいる間は、置いた賭けを額面に崩したチップの山を、手持ちから賭けの丸へ積む
 * - 結果の分からないカードは、伏せたまま置いて溜めてから返す。溜めの長さは、TensionMeter が測る本当の確率から決める
 * - 勝ち（ブラックジャック、払い戻し、ディーラーのバースト）には明るい光と外へ弾ける粒と上がっていく音、
 *   負け（バースト、取られるチップ）には暗さと下へ落ちる粒と下がっていく音を付ける
 * - 手持ち（HUD の数と、卓の手前の手持ちのチップの山）は、チップを賭けの丸へ出したときに減らし、チップが手持ちへ戻ったときにそのチップの額を足す。
 *   手持ちの山は、手持ちが変わるたびに rackStacks で崩し直し、増えた枚数を落とし、減った枚数を消す
 *
 * 時刻の軸: 予定は world、カード・チップ・粒の時刻は present（= presentOffset + world）、
 * 滑らかな変化とフラッシュの制限は real、音は鳴らしたフレームの AudioContext の時刻。
 */
export class Director {
  private readonly o: DirectorOptions;
  private readonly atmosphere: Atmosphere;
  private readonly particles: ParticleFx;
  private readonly ceremony: Ceremony;
  private readonly cues = new CueQueue<FrameTime>();
  /** HUD に出す手持ち */
  private bank: number;
  private newBestShown = false;
  private hands: ShownHand[] = [emptyHand(0)];
  private dealer: ShownDealer = { slots: [], faces: emptyFaces(), hole: -1, state: 'waiting', done: false };
  /** 操作を待っている手（-1 はなし） */
  private active = -1;
  private activeShown = 0;
  private meter: TensionMeter | null = null;
  /** 今のラウンドの出来事のうち、予定に並べた数 */
  private cursor = 0;
  /** 次の出来事を始められる世界時間と、配ったカードが着ききる世界時間 */
  private head = 0;
  private landEnd = 0;
  private cardsUsed = 0;
  /** 負けの音を続けて鳴らした数（下がり続ける） */
  private loseStep = 0;
  /** 続けて着いた払い戻しのチップの数（上がり続ける） */
  private coinStep = 0;
  /** 手持ちを額面ごとに崩した枚数と、それを列に分けた、出している列の額面と枚数、列の数 */
  private readonly rackCounts = new Int32Array(CHIP_VALUES.length);
  private readonly rackDenom = new Int32Array(RACK_COLUMNS);
  private readonly rackCount = new Int32Array(RACK_COLUMNS);
  private readonly wantDenom = new Int32Array(RACK_COLUMNS);
  private readonly wantCount = new Int32Array(RACK_COLUMNS);
  private rackCols = 0;
  private silence: SilenceHandle | null = null;
  private roll: SoundHandle | null = null;
  private tableAppearStart = 0;
  private tableAppearing = false;
  private shockSlot = 0;
  private fever = 0;
  /** 今のラウンドで、ディーラーの伏せたカードを表にする予定を並べたか（ディーラーの番に入ったか）。予定を並べるときに読む */
  private revealScheduled = false;
  /** 配る前の手持ち。場に賭けているチップの割合（大きな溜めにするか）を測る */
  private chipsBefore = 0;
  /** 並べている出来事の時点で、場に賭けているチップの、配る前の手持ちに対する割合 */
  private stake = 0;
  /** このラウンドで大きな溜めをもう使った（1 ラウンドに 1 回まで） */
  private bigUsed = false;
  /** HUD に出す連勝（ラウンドを締めたときに変える） */
  private streakShown = 0;
  private disposed = false;
  private readonly place: CardPlace = { x: 0, y: 0, rot: 0, scale: 1 };
  private readonly spot = { x: 0, y: 0, r: 0 };
  private readonly bounds = { x: 0, y: 0, hw: 0, hh: 0 };
  private readonly chipAt = { x: 0, y: 0 };
  private readonly rackTop = { x: 0, y: 0 };
  private readonly denoms: number[] = [];

  constructor(opts: DirectorOptions) {
    this.o = opts;
    const ports = opts.ports;
    this.atmosphere = new Atmosphere(ports.bgm, ports.flashes);
    this.particles = new ParticleFx(ports.particles);
    this.bank = opts.startChips;
    this.ceremony = new Ceremony({
      sfx: ports.sfx,
      audio: ports.audio,
      air: this.atmosphere,
      camera: opts.camera,
      particles: this.particles,
      shockwave: (at, x, y, speed) => this.shockwave(at, x, y, speed),
      vibrate: (p) => ports.vibrate(p),
      callout: (c) => ports.callout(c),
      newBest: (f) => this.newBest(f),
      bestShown: () => {
        this.newBestShown = true;
        ports.announce('最高スコアを更新しました');
      },
    });
  }

  private present(world: number): number {
    return this.o.presentOffset + world;
  }

  private at(time: number, run: CueRun): void {
    this.cues.add(time, run);
  }

  // ---- プレイの流れから呼ぶ ----

  /** プレイの始まり: 卓が現れる。最初のラウンドの賭けを選び始められる世界時間を返す */
  intro(ft: FrameTime): number {
    this.tableAppearStart = ft.world;
    this.tableAppearing = true;
    this.o.ports.sfx.tableIn();
    this.syncRack(ft.world);
    this.head = ft.world + INTRO.firstBet;
    return this.head;
  }

  /**
   * 次のラウンドの賭けを選び始める。前のラウンドのカードとチップを片付け、置いておく賭け bet のチップを手持ちから賭けの丸へ積む。
   * final は最後のラウンドか（最後のラウンドを知らせる）
   */
  openBetting(bet: number, final: boolean, ft: FrameTime): void {
    this.o.cards.clear();
    this.o.chips.clearSlots(RACK_SLOTS, CHIP_SLOTS);
    this.hands = [emptyHand(0)];
    this.dealer = { slots: [], faces: emptyFaces(), hole: -1, state: 'waiting', done: false };
    this.active = -1;
    this.restack(0, this.hands[0].bet, bet, ft.world, true);
    if (final) this.finalRound();
  }

  /** 賭けを選んでいる間に、置いている賭けが bet に変わった。チップを手持ちから足すか、手持ちへ戻す */
  setBet(bet: number, ft: FrameTime): void {
    const h = this.hands[0];
    const before = h.bet.amount;
    this.restack(0, h.bet, bet, ft.world, true);
    if (bet === 0 && before > 0) this.o.ports.sfx.sweep();
  }

  /**
   * ラウンドを配った（賭けのチップは、賭けを選んでいる間に置いてある）。shoe は配る前のシューの点ごとの枚数、
   * chipsBefore は配る前の手持ち。操作を待てるか、精算できる世界時間を返す
   */
  dealRound(round: Round, shoe: ArrayLike<number>, chipsBefore: number, ft: FrameTime): number {
    this.meter = new TensionMeter(shoe, this.hands[0].bet.amount);
    this.chipsBefore = chipsBefore;
    this.bigUsed = false;
    this.revealScheduled = false;
    this.cursor = 0;
    this.cardsUsed = 0;
    this.loseStep = 0;
    this.coinStep = 0;
    this.head = Math.max(ft.world, this.head);
    this.landEnd = this.head;
    return this.play(round, ft);
  }

  /** 操作の後に増えた出来事を並べる。操作を待てるか、精算できる世界時間を返す */
  play(round: Round, ft: FrameTime): number {
    const meter = this.meter;
    if (!meter) throw new Error('no round');
    let t = Math.max(ft.world, this.head);
    const events = round.events;
    // ダブルと分けると場の賭けが増えるので、並べるたびに測り直す
    this.stake = round.committed / Math.max(1, this.chipsBefore);
    // 手ごとの勝ち・ディーラーのバースト・ブラックジャックは、ラウンドが終わってから（ディーラーの番か、配った直後の決着で）出てくるので、
    // 並べる時点でラウンドの増減の合計が分かる。合計が正のラウンドだけを勝ちとして祝う（差し引き 0 や負けのラウンドを勝ちに見せない）
    const won = round.finished && round.net > 0;
    for (; this.cursor < events.length; this.cursor++) {
      const e = events[this.cursor];
      const tension = meter.see(e);
      if (e.t === 'deal') {
        t = this.deal(e, tension, t, e.faceUp && handClosesAfter(events, this.cursor, e.hand));
        continue;
      }
      t = Math.max(t, this.landEnd);
      t = this.event(e, tension, t, won, e.t === 'reveal' && handClosesAfter(events, this.cursor, DEALER));
    }
    this.head = Math.max(t, this.landEnd);
    return this.head;
  }

  /**
   * 精算したラウンドを締める: 増減と連勝の文字を出し、場のチップを手持ちへ集め、カードを捨てる。
   * 次のラウンドの賭けを選び始められる世界時間を返す
   */
  roundEnd(s: RoundSettlement, ft: FrameTime): number {
    const p = s.payout;
    const ports = this.o.ports;
    let t = Math.max(ft.world, this.head) + SUMMARY.lead;
    // 勝ちと負けの大きさは、配る前の手持ちとの比で測る（同じ額でも、手持ちの大半を賭けた勝ち負けほど大きく見せる）
    const share = s.chipsBefore > 0 ? p.total / s.chipsBefore : 0;
    const tier = p.total > 0 ? payoutTier(share) : 0;
    this.at(t, (f, budget) => {
      // ラウンドの増減は、プレイヤーの手の上（合計の札とディーラーの札の間は狭いので、カードに重ねる）
      const x = TABLE_W / 2;
      const y = PLAYER_Y;
      if (p.total > 0) this.payout(f, budget, p.total, p.bonus, p.multiplierTenths, tier, x, y);
      else if (p.total < 0) {
        ports.callout({ kind: 'loss', total: p.total, x, y });
        const L = LOOK.moments.loss.dark;
        this.atmosphere.darken(Math.min(L.max, L.base + L.perShare * -share));
        this.o.camera.addTrauma(MOTION.loss.trauma);
      } else ports.callout({ kind: 'push', x, y });
      const st = s.streak;
      if (st.after > st.before && st.after >= 2) {
        ports.callout({ kind: 'streak', count: st.after, multiplierTenths: multiplierTenths(st.after + 1) });
        ports.sfx.streak(st.after);
        this.o.camera.addTrauma(MOTION.streak.trauma);
      } else if (st.broken) {
        ports.callout({ kind: 'streakBreak', count: st.before });
        ports.sfx.streakBreak();
      }
      this.streakShown = st.after;
      this.fever = feverLevel(st.after);
      this.atmosphere.setFever(this.fever);
      ports.announce(this.roundText(p.total, s.chips));
    });
    t += SUMMARY.hold.base + SUMMARY.hold.perLevel * tier;
    t = this.collect(t, p.bonus, p.total > 0);
    t = this.sweep(t);
    this.head = t + SUMMARY.next;
    return this.head;
  }

  /** 選べない操作を選んだ。鈍い音で知らせる */
  rejected(): void {
    this.o.ports.sfx.nope();
    this.o.camera.addTrauma(MOTION.rejected.trauma);
  }

  /** 終わりの儀式を始める */
  ending(result: RunResult, ft: FrameTime): void {
    this.atmosphere.setFever(0);
    this.ceremony.start(ft, result);
  }

  /** 終わりの儀式をタップで飛ばす。飛ばせたら true */
  skip(): boolean {
    return this.ceremony.skip();
  }

  /** 捨てる。予定を捨て、かけている無音を解く */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cues.clear();
    this.endSuspense();
    this.ceremony.stopHush();
  }

  // ---- フレーム ----

  /** 1 フレーム進める。終わりの儀式が終わったフレームで 1 回だけ true を返す */
  frame(ft: FrameTime, budget: number): boolean {
    if (this.disposed) return false;
    this.cues.runDue(ft.world, ft, budget);
    const done = this.ceremony.update(ft, budget);
    const fx = this.o.fx;
    this.atmosphere.update(ft, fx);
    this.o.camera.update(ft.worldDt);
    fx.tableAppear = this.tableAppearing ? Math.min(1, (ft.world - this.tableAppearStart) / INTRO.table) : 1;
    if (fx.tableAppear >= 1) this.tableAppearing = false;
    this.writeTable(ft);
    return done;
  }

  /** HUD の手持ち・合計の札・賭けの額の札を書く。札の位置は px で CSS ピクセルへ直す */
  hud(out: HudState, px: PxProjector): void {
    out.chips = this.bank;
    out.newBest = this.newBestShown;
    out.streak = this.streakShown;
    out.nextMultiplierTenths = multiplierTenths(this.streakShown + 1);
    out.fever = this.fever;
    const count = this.hands.length;
    for (let i = 0; i < MAX_HANDS; i++) {
      const label = out.hands[i];
      const bet = out.bets[i];
      const h = i < count ? this.hands[i] : null;
      if (h && h.bet.amount > 0) {
        betLabelPlace(i, count, this.chipAt);
        const half = handSlotWidth(count) / 2;
        writeBet(bet, h.bet.amount, count >= 3, px.x(this.chipAt.x), px.y(this.chipAt.y), px.x(this.chipAt.x + half) - px.x(this.chipAt.x - half));
      } else bet.shown = false;
      if (!h || h.faces.cards.length === 0) {
        label.shown = false;
        continue;
      }
      writeLabel(label, h.faces, h.state, h.done, px.x(playerLabelX(i, count)), px.y(playerLabelY(count)));
    }
    const d = this.dealer;
    if (d.faces.cards.length === 0) out.dealer.shown = false;
    else writeLabel(out.dealer, d.faces, d.state, d.done, px.x(DEALER_LABEL.x), px.y(DEALER_LABEL.y));
  }

  // ---- 出来事 ----

  /** カードを 1 枚配る予定を並べる。次の出来事を始められる世界時間を返す */
  private deal(e: Extract<RoundEvent, { t: 'deal' }>, tension: number, t: number, closes: boolean): number {
    // プレイヤーが選んで引いた 1 枚と、ディーラーの番に引く 1 枚は、1 枚ずつ見せる
    const deliberate = e.chosen || (e.hand === DEALER && this.revealScheduled);
    const start = deliberate ? Math.max(t, this.landEnd) : t;
    const fly = deliberate ? DEAL.draw : DEAL.fly;
    const suspense = e.faceUp && deliberate && tension >= SUSPENSE.from;
    const big = suspense && this.claimBig(tension);
    const hold = suspense ? SUSPENSE.hold.base + SUSPENSE.hold.perTension * tension : 0;
    const flip = suspense ? SUSPENSE.flip.base + SUSPENSE.flip.perTension * tension : 0;
    const slot = this.cardsUsed++;
    const landAt = start + fly;
    const shownAt = suspense ? landAt + hold + flip : e.faceUp ? start + fly * DEAL.flipTo : landAt;
    this.at(start, (f) => this.launch(e, slot, start, fly, suspense, f));
    this.at(landAt, (_f, budget) => this.landed(e, slot, deliberate, tension, big, hold, landAt, budget));
    if (suspense) this.at(landAt + hold, () => this.reveal(slot, e.card, landAt + hold, flip, true));
    if (e.faceUp) this.at(shownAt, () => this.faceShown(e.hand, e.card, deliberate, closes));
    const end = shownAt + DEAL.settle;
    this.landEnd = Math.max(this.landEnd, end);
    return deliberate ? end : start + DEAL.gap;
  }

  /** カードを出来事 e の手へ飛ばし始める。同じ手のほかのカードは詰めて並べ直す */
  private launch(e: Extract<RoundEvent, { t: 'deal' }>, slot: number, start: number, fly: number, suspense: boolean, f: FrameTime): void {
    const cards = this.o.cards;
    const at = this.present(start);
    const t = this.present(f.world);
    if (e.hand === DEALER) {
      const d = this.dealer;
      d.slots.push(slot);
      if (!e.faceUp) d.hole = slot;
      d.slots.forEach((s, k) => {
        dealerCardPlace(k, d.slots.length, this.place);
        if (s === slot) cards.fly(s, FROM_SHOE, this.place, at, fly, DEAL.lift);
        else cards.slide(s, this.place, t, DEAL.settle * 2);
      });
    } else {
      const h = this.hands[e.hand];
      h.slots.push(slot);
      this.layoutHand(e.hand, slot, at, fly, t);
    }
    cards.setFace(slot, BACK);
    if (e.faceUp && !suspense) cards.flip(slot, e.card, at + fly * DEAL.flipFrom, fly * (DEAL.flipTo - DEAL.flipFrom));
    this.o.ports.sfx.deal(fly);
  }

  /** 手 i のカードを並べ直す。flying は今シューから飛ばす 1 枚（ほかは今の場所から滑らせる） */
  private layoutHand(i: number, flying: number, at: number, fly: number, now: number): void {
    const h = this.hands[i];
    const count = this.hands.length;
    const cards = this.o.cards;
    h.slots.forEach((s, k) => {
      playerCardPlace(i, count, k, h.slots.length, h.doubled && k === 2, this.place);
      if (s === flying) cards.fly(s, FROM_SHOE, this.place, at, fly, DEAL.lift);
      else cards.slide(s, this.place, now, DEAL.settle * 2);
    });
  }

  /** カードが手に着いた。大きな溜めのカードなら、ここから絞り込む */
  private landed(e: Extract<RoundEvent, { t: 'deal' }>, slot: number, deliberate: boolean, tension: number, big: boolean, hold: number, landAt: number, budget: number): void {
    const cards = this.o.cards;
    const sfx = this.o.ports.sfx;
    const now = this.present(landAt);
    cards.landed(slot, now);
    sfx.land(deliberate);
    cards.placeAt(slot, now, this.place);
    this.particles.land(now, this.place.x, this.place.y, deliberate, budget);
    this.o.camera.addTrauma(deliberate ? MOTION.land.chosen : MOTION.land.trauma);
    if (!e.faceUp) this.o.ports.announce('ディーラーは 1 枚を伏せました');
    if (big) this.beginSuspense(tension, hold, this.place.x, this.place.y);
  }

  /**
   * 分からなさ tension の 1 枚を、大きな溜めにするか（SUSPENSE.big と bigStake）。1 ラウンドで最初に当てはまった 1 枚だけにし、
   * 大きな溜めにすると決めたら使ったことにする
   */
  private claimBig(tension: number): boolean {
    if (this.bigUsed || tension < SUSPENSE.big || this.stake < SUSPENSE.bigStake) return false;
    this.bigUsed = true;
    return true;
  }

  /** 大きな溜め: hold 秒、(x, y) へ向かって画面の縁から絞り込んでカメラを寄せ、ほかの音を消してドラムロールを鳴らす */
  private beginSuspense(tension: number, hold: number, x: number, y: number): void {
    this.endSuspense();
    this.atmosphere.setFocus(tension, x, y);
    const s = MOTION.suspense.pull;
    this.o.camera.pull(s.amount * tension, s.attack, s.release);
    this.silence = this.o.ports.audio.silence(Math.max(0.01, hold - SILENCE_DELAY), 0.005, SILENCE_DELAY);
    this.roll = this.o.ports.sfx.drumRoll(hold);
  }

  private endSuspense(): void {
    this.silence?.cancel();
    this.silence = null;
    this.roll?.stop();
    this.roll = null;
    this.atmosphere.setFocus(0, 0, 0);
  }

  /** 溜めた（か、置いたままの）カードを、時刻 start から duration かけて表へ返す */
  private reveal(slot: number, card: Card, start: number, duration: number, suspense: boolean): void {
    if (suspense) {
      // 返し始めで無音を解く（返る音から聞かせる）。ドラムロールは返し始めで途切れる長さで鳴らしてある。絞り込みは返している間に戻す
      this.silence?.cancel();
      this.silence = null;
      this.roll = null;
      this.atmosphere.setFocus(0, 0, 0);
    }
    this.o.cards.flip(slot, card, this.present(start), duration);
    this.o.ports.sfx.flip(suspense);
  }

  /** カードの表が見えた。合計の札を増やし、読み上げる */
  /** カードの表が見えた。closes は、この 1 枚で手の合計が決まる（もう引かない）か */
  private faceShown(hand: number, card: Card, deliberate: boolean, closes: boolean): void {
    const ports = this.o.ports;
    if (hand === DEALER) {
      if (closes) this.dealer.done = true;
      const d = this.dealer.faces;
      d.cards.push(card);
      refresh(d);
      ports.announce(`ディーラー: ${cardName(card)}${d.cards.length > 1 ? `。合計 ${d.total}` : ''}`);
      return;
    }
    const h = this.hands[hand];
    if (closes) h.done = true;
    h.faces.cards.push(card);
    refresh(h.faces);
    if (deliberate || h.faces.cards.length >= 2) {
      const prefix = this.hands.length > 1 ? `手 ${hand + 1}` : 'あなた';
      ports.announce(`${prefix}: ${cardName(card)}。合計 ${h.faces.total}`);
    }
  }

  /** カードを配る以外の出来事の予定を並べる。won はラウンドの増減の合計が正か（勝ちとして祝うか）。次の出来事を始められる世界時間を返す */
  private event(e: Exclude<RoundEvent, { t: 'deal' }>, tension: number, t: number, won: boolean, closes: boolean): number {
    const ports = this.o.ports;
    switch (e.t) {
      case 'reshuffle':
        this.at(t, () => {
          ports.callout({ kind: 'reshuffle' });
          ports.sfx.reshuffle();
          ports.announce('シューが尽きたので、捨てたカードを混ぜ直しました');
        });
        return t + 0.5;
      case 'peek':
        return this.peek(e.blackjack, t);
      case 'reveal':
        return this.holeReveal(e.card, tension, t, closes);
      case 'split':
        this.at(t, (f) => this.split(e.hand, f));
        return t + ACTION.split;
      case 'double':
        this.at(t, (f) => {
          const h = this.hands[e.hand];
          h.doubled = true;
          this.restack(e.hand, h.bet, h.bet.amount * 2, f.world, true);
          ports.sfx.double();
          ports.announce(`ダブル。賭けは ${formatScore(h.bet.amount)}`);
        });
        return t + ACTION.double;
      case 'turn':
        this.at(t, () => {
          this.active = e.hand;
          this.hands.forEach((h, i) => {
            if (h.state === 'active' || h.state === 'waiting') h.state = i === e.hand ? 'active' : 'waiting';
          });
          if (this.hands.length > 1) ports.announce(`手 ${e.hand + 1} の番です`);
        });
        return t;
      case 'stand': {
        const twentyOne = e.auto && e.total === 21;
        this.at(t, (f, budget) => {
          const h = this.hands[e.hand];
          if (h.state === 'active') h.state = 'waiting';
          h.done = true;
          this.active = -1;
          if (twentyOne) this.twentyOne(e.hand, f, budget);
          else if (!e.auto) ports.sfx.stand();
        });
        return t + (twentyOne ? 0.35 : ACTION.stand);
      }
      case 'bust':
        this.at(t, (f, budget) => this.bust(e.hand, e.total, f, budget));
        return t + ACTION.bust;
      case 'natural':
        this.at(t, (f, budget) => this.natural(e.hand, won, f, budget));
        return t + ACTION.natural;
      case 'dealerNatural':
        this.at(t, () => {
          this.dealer.state = 'blackjack';
          this.dealer.done = true;
          ports.sfx.dealerBlackjack();
          this.atmosphere.darken(LOOK.moments.dealerNatural.dark);
          this.o.camera.addTrauma(MOTION.dealerNatural.trauma);
          ports.announce('ディーラーはブラックジャックです');
        });
        return t + ACTION.dealerNatural;
      case 'dealerStand':
        this.at(t, () => {
          this.dealer.done = true;
          ports.announce(`ディーラーは ${e.total} で止めました`);
        });
        return t + ACTION.dealerDone;
      case 'dealerBust':
        this.at(t, (f, budget) => this.dealerBust(e.total, won, f, budget));
        return t + ACTION.dealerBust;
      case 'settle':
        return this.settle(e.hand, e.result, e.delta, won, t);
      case 'end':
        // 比べる手が残っていなくてディーラーが引かなかったときも、ここで合計が決まる
        this.at(t, () => {
          this.active = -1;
          this.dealer.done = true;
        });
        return t + SETTLE.end;
    }
  }

  /**
   * ディーラーが伏せたカードを確かめる: 本物のディーラーと同じく、角を静かに持ち上げて戻すだけにし、溜めない。
   * ブラックジャックなら、続く出来事（伏せたカードを表にする）で決着を見せる。そうでなければ、何も知らせずに次へ進む
   * （何も起きない確かめを溜めると、溜めた後に何も起きないように見える）
   */
  private peek(blackjack: boolean, t: number): number {
    this.at(t, () => {
      const slot = this.dealer.hole;
      if (slot < 0) return;
      this.o.cards.peek(slot, this.present(t), PEEK.duration);
      this.o.ports.sfx.peek();
    });
    if (!blackjack) this.at(t + PEEK.duration, () => this.o.ports.announce('ディーラーはブラックジャックではありません'));
    return t + PEEK.duration;
  }

  /** ディーラーの伏せたカードを表にする。結果が分からなければ溜めてから返す（大きな溜めなら絞り込んで無音にする） */
  private holeReveal(card: Card, tension: number, t: number, closes: boolean): number {
    this.revealScheduled = true;
    const suspense = tension >= SUSPENSE.from;
    const big = suspense && this.claimBig(tension);
    const hold = suspense ? SUSPENSE.hold.base + SUSPENSE.hold.perTension * tension : 0;
    const flip = suspense ? SUSPENSE.flip.base + SUSPENSE.flip.perTension * tension : SUSPENSE.quickFlip;
    this.at(t, () => {
      this.active = -1;
      const slot = this.dealer.hole;
      if (slot < 0 || !big) return;
      this.o.cards.placeAt(slot, this.present(t), this.place);
      this.beginSuspense(tension, hold, this.place.x, this.place.y);
    });
    this.at(t + hold, () => {
      const slot = this.dealer.hole;
      if (slot >= 0) this.reveal(slot, card, t + hold, flip, suspense);
    });
    this.at(t + hold + flip, () => this.faceShown(DEALER, card, true, closes));
    const end = t + hold + flip + DEAL.settle;
    this.landEnd = Math.max(this.landEnd, end);
    return end;
  }

  /** 手 i を 2 つに分ける。2 枚目を新しい手へ滑らせ、すべての手とチップの山を並べ直し、新しい手の賭けのチップを手持ちから出す */
  private split(i: number, f: FrameTime): void {
    const h = this.hands[i];
    const right = emptyHand(this.hands.length);
    const second = h.slots.pop() as number;
    const secondFace = h.faces.cards.pop() as Card;
    refresh(h.faces);
    right.slots.push(second);
    right.faces.cards.push(secondFace);
    refresh(right.faces);
    h.state = 'waiting';
    this.hands.splice(i + 1, 0, right);
    const now = this.present(f.world);
    const count = this.hands.length;
    this.hands.forEach((hand, j) => {
      hand.slots.forEach((s, k) => this.o.cards.slide(s, playerCardPlace(j, count, k, hand.slots.length, hand.doubled && k === 2, this.place), now, ACTION.split));
      hand.bet.denoms.forEach((_d, n) => {
        chipPlace(j, count, n, 'center', this.chipAt);
        this.o.chips.flyFromHere(hand.bet.base + n, this.chipAt.x, this.chipAt.y, now, ACTION.split, 0);
      });
    });
    this.restack(i + 1, right.bet, h.bet.amount, f.world, true);
    this.o.ports.sfx.split();
    this.o.ports.announce(`分けました。手は ${count} つです`);
  }

  /**
   * 手 i のチップの山 stack を、額 amount を額面に崩した山に積み直す。今の山と同じ額面のところはそのまま残し、
   * 違うところは置き替え、足りない分は手持ちの山（その額面の山の上）から飛ばして積み、余った分は手持ちの山へ戻して消す。
   * 出し入れした額を手持ちから引き（戻せば足し）、手持ちの山を崩し直す
   */
  private restack(i: number, stack: Stack, amount: number, world: number, fromRack: boolean): void {
    const want = chipStack(amount, this.denoms);
    const chips = this.o.chips;
    const count = this.hands.length;
    const now = this.present(world);
    const h = this.hands[i];
    const spot = stack === h.win ? 'right' : h.win.amount > 0 ? 'left' : 'center';
    const have = stack.denoms.length;
    const from = this.rackTop;
    let flown = 0;
    for (let k = 0; k < Math.max(have, want.length); k++) {
      const slot = stack.base + k;
      if (k < want.length && k < have && want[k] === stack.denoms[k]) continue;
      if (k < want.length) {
        chipPlace(i, count, k, spot, this.chipAt);
        this.rackTopOf(want[k], from);
        const at = now + flown * SETTLE.chipGap;
        chips.fly(slot, want[k], from.x, from.y, this.chipAt.x, this.chipAt.y, at, SETTLE.fly, 0.6);
        const index = flown++;
        this.at(world + index * SETTLE.chipGap + SETTLE.fly, () => this.o.ports.sfx.chip(index));
        continue;
      }
      this.rackTopOf(stack.denoms[k], from);
      chips.flyFromHere(slot, from.x, from.y, now, SETTLE.fly, 0.4);
      chips.fade(slot, now + SETTLE.fly - CHIP_FADE);
    }
    stack.denoms.length = 0;
    for (const d of want) stack.denoms.push(d);
    if (fromRack) {
      this.bank -= amount - stack.amount;
      this.syncRack(world);
    }
    stack.amount = amount;
  }

  /**
   * 手持ちの山を、今の手持ちに合わせて崩し直す（rackStacks で額面ごとの枚数にし、大きい額面から左へ RACK_CAP 枚ずつの列に分ける）。
   * 同じ額面のままの列は、増えた枚数を少し上から落とし、減った枚数を上から消す。額面の変わった列は積み直す。
   * 列の数が変わったら、残す列は新しい位置へ滑らせる
   */
  private syncRack(world: number): void {
    const counts = rackStacks(this.bank, this.rackCounts);
    const wantDenom = this.wantDenom;
    const wantCount = this.wantCount;
    let cols = 0;
    for (let d = counts.length - 1; d >= 0; d--) {
      for (let left = counts[d]; left > 0 && cols < RACK_COLUMNS; left -= RACK_CAP) {
        wantDenom[cols] = d;
        wantCount[cols] = Math.min(RACK_CAP, left);
        cols++;
      }
    }
    const chips = this.o.chips;
    const now = this.present(world);
    const moved = cols !== this.rackCols;
    for (let c = 0; c < RACK_COLUMNS; c++) {
      const base = c * RACK_CAP;
      const had = c < this.rackCols ? this.rackCount[c] : 0;
      const want = c < cols ? wantCount[c] : 0;
      const same = c < this.rackCols && c < cols && this.rackDenom[c] === wantDenom[c];
      const keep = same ? Math.min(had, want) : 0;
      for (let k = 0; k < keep; k++) {
        if (!moved) break;
        rackPlace(c, cols, k, this.chipAt);
        chips.flyFromHere(base + k, this.chipAt.x, this.chipAt.y, now, RACK_SLIDE, 0);
      }
      for (let k = keep; k < want; k++) {
        rackPlace(c, cols, k, this.chipAt);
        chips.fly(base + k, wantDenom[c], this.chipAt.x, this.chipAt.y + RACK_DROP, this.chipAt.x, this.chipAt.y, now + (k - keep) * RACK_GAP, RACK_FALL, 0);
      }
      for (let k = want; k < had; k++) chips.fade(base + k, now);
      this.rackDenom[c] = c < cols ? wantDenom[c] : -1;
      this.rackCount[c] = want;
    }
    this.rackCols = cols;
  }

  /** 手持ちの山のうち、額面 d の列のいちばん上の位置を out に書く（チップを出し入れする場所）。その額面の列がなければ、列の並びの真ん中の手前 */
  private rackTopOf(d: number, out: { x: number; y: number }): { x: number; y: number } {
    for (let c = this.rackCols - 1; c >= 0; c--) {
      if (this.rackDenom[c] === d) return rackPlace(c, this.rackCols, this.rackCount[c], out);
    }
    out.x = TABLE_W / 2;
    out.y = RACK_H / 2;
    return out;
  }

  /** 21 になった（ブラックジャックではない） */
  private twentyOne(i: number, f: FrameTime, budget: number): void {
    const h = this.hands[i];
    const now = this.present(f.world);
    for (const s of h.slots) this.o.cards.glow(s, now, CardGlow.TwentyOne);
    this.o.ports.sfx.twentyOne();
    this.particles.twentyOne(now, handCenterX(i, this.hands.length), PLAYER_Y, budget);
    this.atmosphere.flare(f.real, 0, LOOK.moments.twentyOne.boost);
    this.atmosphere.kick(MOTION.twentyOne.kick);
    this.o.camera.addTrauma(MOTION.twentyOne.trauma);
  }

  /** バーストした: 手を暗くし、暗い破片を落とし、下がっていく音 */
  private bust(i: number, total: number, f: FrameTime, budget: number): void {
    const h = this.hands[i];
    h.state = 'bust';
    h.done = true;
    this.active = -1;
    const now = this.present(f.world);
    for (const s of h.slots) this.o.cards.dim(s, now);
    this.o.ports.sfx.bust();
    this.particles.bust(now, handCenterX(i, this.hands.length), PLAYER_Y, budget);
    this.atmosphere.darken(LOOK.moments.bust.dark);
    this.o.camera.addTrauma(MOTION.bust.trauma);
    pull(this.o.camera, MOTION.bust.pull);
    this.o.ports.announce(`バースト。合計 ${total}`);
  }

  /**
   * ブラックジャック: ヒットストップ・スローモーション・閃光・放射状の光・虹色・衝撃波・振動。
   * won でなければ（ディーラーもブラックジャックで引き分け）、祝わずに知らせるだけ
   */
  private natural(i: number, won: boolean, f: FrameTime, budget: number): void {
    const h = this.hands[i];
    h.state = 'blackjack';
    h.done = true;
    if (!won) {
      this.o.ports.announce('ブラックジャック。ディーラーもブラックジャックです');
      return;
    }
    const now = this.present(f.world);
    const x = handCenterX(i, this.hands.length);
    const y = PLAYER_Y;
    for (const s of h.slots) {
      this.o.cards.glow(s, now, CardGlow.Blackjack);
      this.o.cards.setShake(s, true);
    }
    const ports = this.o.ports;
    const L = LOOK.moments.natural;
    const m = MOTION.natural;
    ports.sfx.blackjack();
    ports.callout({ kind: 'blackjack', x, y: y + 1.6 });
    this.particles.blackjack(now, x, y, budget);
    this.hitStop(f, x, y, 4, HIT_STOP.natural);
    this.o.clock.slowMoWorld(SLOW_MO.natural.scale, SLOW_MO.natural.hold, SLOW_MO.release);
    this.atmosphere.flare(f.real, LOOK.flash * L.flash, L.boost);
    this.atmosphere.spreadRays(L.rays);
    this.atmosphere.prism(L.prism);
    this.atmosphere.kick(m.kick);
    this.o.camera.addTrauma(m.trauma);
    pull(this.o.camera, m.pull);
    this.o.camera.punch(m.punch.amount, m.punch.attack, m.punch.release);
    this.shockwave(now, x, y, 12);
    ports.vibrate(HAPTICS.natural);
    ports.announce('ブラックジャック');
    this.at(f.world + ACTION.natural * 0.5, () => {
      for (const s of h.slots) this.o.cards.setShake(s, false);
    });
  }

  /**
   * ディーラーがバーストした: ディーラーの手を暗くする。won（ラウンドに勝った）なら明るい火花と上がる音で祝い、
   * そうでなければ（ほかの手のバーストやダブルの負けで、差し引き 0 か負け）上がらない音と文字だけにする
   */
  private dealerBust(total: number, won: boolean, f: FrameTime, budget: number): void {
    const d = this.dealer;
    d.state = 'bust';
    d.done = true;
    const now = this.present(f.world);
    for (const s of d.slots) this.o.cards.dim(s, now);
    const ports = this.o.ports;
    ports.sfx.dealerBust(won);
    ports.callout({ kind: 'dealerBust', celebrate: won, x: TABLE_W / 2, y: DEALER_Y - 1.9 });
    ports.announce(`ディーラーはバースト。合計 ${total}`);
    if (!won) return;
    this.particles.dealerBust(now, TABLE_W / 2, DEALER_Y, budget);
    const L = LOOK.moments.dealerBust;
    this.atmosphere.flare(f.real, 0, L.boost);
    this.atmosphere.spreadRays(L.rays);
    this.atmosphere.kick(MOTION.dealerBust.kick);
    this.o.camera.addTrauma(MOTION.dealerBust.trauma);
  }

  /**
   * 手 i の決着。勝ちは払い戻しのチップの山（増えた額を額面に崩したもの）をディーラーのチップ置き場から飛ばしてきて、
   * 負けは賭けのチップをディーラーへ取られる。
   * 勝った手の光・光るチップ・上がっていく音は、won（ラウンドの増減の合計が正）のときだけ。そうでなければチップを置く音だけにする
   */
  private settle(i: number, result: 'win' | 'lose' | 'push' | 'blackjack', delta: number, won: boolean, t: number): number {
    const ports = this.o.ports;
    const paid = result === 'win' || result === 'blackjack';
    const tokens = paid ? chipStack(delta, this.denoms).length : 0;
    this.at(t, (f) => {
      const h = this.hands[i];
      h.done = true;
      const count = this.hands.length;
      const now = this.present(f.world);
      if (paid) {
        if (result === 'win') {
          h.state = 'win';
          if (won) for (const s of h.slots) this.o.cards.glow(s, now, CardGlow.Win);
        }
        // 賭けの山を左へずらし、空いた右に払い戻しの山を積む
        h.bet.denoms.forEach((_d, k) => {
          chipPlace(i, count, k, 'left', this.chipAt);
          this.o.chips.flyFromHere(h.bet.base + k, this.chipAt.x, this.chipAt.y, now, SETTLE.fly * 0.6, 0);
        });
        const want = chipStack(delta, this.denoms);
        h.win.denoms.length = 0;
        h.win.amount = delta;
        want.forEach((d, k) => {
          const slot = h.win.base + k;
          h.win.denoms.push(d);
          chipPlace(i, count, k, 'right', this.chipAt);
          const x = this.chipAt.x;
          const y = this.chipAt.y;
          this.o.chips.fly(slot, d, DEALER_TRAY.x, DEALER_TRAY.y, x, y, now + k * SETTLE.chipGap, SETTLE.fly, 0.8);
          if (won) this.o.chips.shine(slot, now + k * SETTLE.chipGap + SETTLE.fly);
          const step = won ? this.coinStep++ : k;
          this.at(f.world + k * SETTLE.chipGap + SETTLE.fly, (g, budget) => {
            if (won) ports.sfx.coin(step, Math.min(1, this.fever + 0.2));
            else ports.sfx.chip(step);
            this.particles.chipLand(this.present(g.world), x, y, won, budget);
            this.o.camera.addTrauma(MOTION.chipLand.trauma);
          });
        });
        ports.announce(result === 'blackjack' ? `ブラックジャックの払い戻し ${formatSigned(delta)}` : `勝ち ${formatSigned(delta)}`);
        return;
      }
      if (result === 'lose') {
        if (h.state !== 'bust') h.state = 'lose';
        for (const s of h.slots) this.o.cards.dim(s, now);
        ports.sfx.lose(this.loseStep++);
        h.bet.denoms.forEach((_d, k) => {
          const c = h.bet.base + k;
          const at = now + k * SETTLE.chipGap;
          this.o.chips.dim(c, at);
          this.o.chips.flyFromHere(c, DEALER_TRAY.x, DEALER_TRAY.y, at, SETTLE.fly, 0.3);
          this.o.chips.fade(c, at + SETTLE.fly - CHIP_FADE);
        });
        this.at(f.world + SETTLE.fly, (g, budget) => this.particles.taken(this.present(g.world), DEALER_TRAY.x, DEALER_TRAY.y, budget));
        h.bet.denoms.length = 0;
        h.bet.amount = 0;
        if (h.state === 'lose') ports.announce(`負け ${formatSigned(delta)}`);
        return;
      }
      h.state = 'push';
      ports.sfx.push();
      ports.announce('引き分け');
    });
    return t + SETTLE.handGap + tokens * SETTLE.chipGap;
  }

  /** 勝ったラウンドの増減を見せる。段階 1 以上はヒットストップ、大きな勝ちはスローモーションと衝撃波 */
  private payout(f: FrameTime, budget: number, total: number, bonus: number, tenths: number, tier: number, x: number, y: number): void {
    const ports = this.o.ports;
    const m = MOTION.payout;
    const L = LOOK.moments.payout;
    ports.callout({ kind: 'payout', total, bonus, multiplierTenths: tenths, level: tier, x, y });
    ports.sfx.win(tier);
    this.atmosphere.kick(Math.min(1, m.kick.base + m.kick.perTier * tier));
    this.o.camera.addTrauma(m.trauma.base + m.trauma.perTier * tier);
    this.o.camera.punch(m.punch.base + m.punch.perTier * tier, m.punch.attack, m.punch.release);
    this.particles.win(this.present(f.world), x, y, tier, budget);
    const flash = tier >= BIG_TIER ? LOOK.flash * (L.flash.base + L.flash.perTier * tier) : 0;
    this.atmosphere.flare(f.real, flash, L.boost.base + L.boost.perTier * tier);
    if (tier >= 1) {
      this.atmosphere.spreadRays(L.rays.base + L.rays.perTier * tier);
      const stop = hitStopFor(tier, this.fever > 0);
      this.hitStop(f, x, y, tier, stop);
    }
    if (tier >= BIG_TIER) {
      this.o.clock.slowMoWorld(SLOW_MO.big.scale, SLOW_MO.big.hold, SLOW_MO.release);
      pull(this.o.camera, m.big.pull);
      this.shockwave(this.present(f.world), x, y, m.big.shockSpeed.base + m.big.shockSpeed.perTier * tier);
      ports.vibrate(tier >= 4 ? HAPTICS.top : HAPTICS.big);
      if (tier >= 4) this.atmosphere.prism(L.topPrism);
    }
  }

  /**
   * 場のチップを手持ちへ集める。着くたびに、そのチップが運ぶ額（chipShare。山のいちばん上のチップは、積みきれなかった分も運ぶ）を
   * HUD の手持ちに足す。上乗せは最後に光の筋で足す。
   * won（ラウンドの増減の合計が正）なら、着くたびに上がっていく音と金の光の筋。そうでなければ（戻るのが賭けたチップだけ）チップを置く音だけ
   */
  private collect(t: number, bonus: number, won: boolean): number {
    const ports = this.o.ports;
    let k = 0;
    for (const h of this.hands) {
      for (const stack of [h.bet, h.win]) {
        // 山の最初のチップが飛び立つときに、山を空にする（それまでは賭けの札と丸を出しておく）
        if (stack.denoms.length > 0) {
          this.at(t + k * SUMMARY.collectGap, () => {
            stack.denoms.length = 0;
            stack.amount = 0;
          });
        }
        const amount = stack.amount;
        stack.denoms.forEach((d, n) => {
          const c = stack.base + n;
          const value = chipShare(stack.denoms, amount, n);
          const at = t + k * SUMMARY.collectGap;
          const index = k++;
          this.at(at, () => {
            const now = this.present(at);
            // 手持ちのその額面の山の上へ飛ばし、着いたら手持ちを崩し直す（飛んだチップは消え、山のチップに替わる）
            const to = this.rackTopOf(d, this.rackTop);
            this.o.chips.flyFromHere(c, to.x, to.y, now, SUMMARY.collectFly, 1.2);
            this.o.chips.fade(c, now + SUMMARY.collectFly - CHIP_FADE);
            const p = this.o.chips.positionAt(c, now);
            this.particles.collect(now, p.x, p.y, to.x, to.y, SUMMARY.collectFly, won);
          });
          this.at(at + SUMMARY.collectFly, () => {
            this.bank += value;
            this.syncRack(at + SUMMARY.collectFly);
            if (won) ports.sfx.coin(this.coinStep++, Math.min(1, this.fever + 0.3));
            else ports.sfx.chip(index);
          });
        });
      }
    }
    let end = t + Math.max(0, k - 1) * SUMMARY.collectGap + SUMMARY.collectFly;
    if (bonus > 0) {
      const at = end;
      const streaks = Math.min(24, 6 + chipStack(bonus, this.denoms).length * 2);
      this.at(at, () => {
        const now = this.present(at);
        for (let n = 0; n < streaks; n++) this.particles.collect(now, TABLE_W / 2, PLAYER_Y, TABLE_W / 2, RACK_H / 2, SUMMARY.collectFly, true);
      });
      end = at + SUMMARY.collectFly;
      const landed = end;
      this.at(end, () => {
        this.bank += bonus;
        this.syncRack(landed);
        ports.sfx.coin(this.coinStep++, 1);
      });
    }
    return end;
  }

  /** 場のカードを捨てる: 1 枚ずつ裏に返しながら、ディーラーの手元（卓の奥）へ小さくして滑らせ、消す。合計の札も消す */
  private sweep(t: number): number {
    const all: number[] = [];
    for (const h of this.hands) all.push(...h.slots);
    all.push(...this.dealer.slots);
    this.at(t, () => {
      this.hands.forEach((h) => {
        h.faces.cards.length = 0;
        refresh(h.faces);
      });
      this.dealer.faces.cards.length = 0;
      refresh(this.dealer.faces);
      this.active = -1;
      this.o.ports.sfx.sweep();
    });
    all.forEach((s, k) => {
      const at = t + k * SUMMARY.sweepGap;
      this.at(at, () => {
        const now = this.present(at);
        this.o.cards.slide(s, { x: COLLECT_CARDS.x, y: COLLECT_CARDS.y, rot: (Math.random() - 0.5) * 0.3, scale: 0.6 }, now, SUMMARY.sweep);
        this.o.cards.flip(s, BACK, now, SUMMARY.sweep * 0.5);
        this.o.cards.fade(s, now + SUMMARY.sweep * 0.5);
      });
    });
    return t + Math.max(0, all.length - 1) * SUMMARY.sweepGap + SUMMARY.sweep;
  }

  /**
   * 最後の手持ちが記録のある最高スコアを超えて終えた（終わりの儀式の決着の後）: 駆け上がる和音、光、カメラの引き。HUD に BEST を出す。
   * 手持ちはプレイの途中で増えも減りもするので、記録になる最後の手持ちが決まってから出す
   */
  private newBest(f: FrameTime): void {
    this.newBestShown = true;
    const L = LOOK.moments.newBest;
    this.o.ports.sfx.newBest();
    this.atmosphere.spreadRays(L.rays);
    this.atmosphere.prism(L.prism);
    this.atmosphere.flare(f.real, 0, L.boost);
    pull(this.o.camera, MOTION.newBest.pull);
    this.o.camera.addTrauma(MOTION.newBest.trauma);
    this.o.ports.vibrate(HAPTICS.newBest);
    this.o.ports.announce('最高スコアを更新しました');
  }

  /** 最後のラウンドの賭けを選び始めた */
  private finalRound(): void {
    this.o.fx.finalRound = 1;
    this.o.ports.callout({ kind: 'finalRound' });
    this.o.ports.sfx.finalRound();
    this.o.camera.addTrauma(MOTION.finalRound.trauma);
    this.o.ports.announce('最後のラウンドです');
  }

  /** ヒットストップ: duration 秒（実時間）世界の時間を止め、カードとチップを震わせ、集中線と RGB のずれを出す。振動も重ねる */
  private hitStop(f: FrameTime, x: number, y: number, tier: number, duration: number): void {
    if (duration <= 0) return;
    const amp = AIR.hitAmp.base + AIR.hitAmp.perTier * tier;
    this.o.clock.hitStop(duration);
    this.atmosphere.hitStop(x, y, amp, duration, f.real);
    this.o.ports.vibrate(HAPTICS.hitStop.base + HAPTICS.hitStop.perTier * tier);
  }

  private shockwave(at: number, x: number, y: number, speed: number): void {
    const w = this.o.fx.shockwaves;
    const o = this.shockSlot * 4;
    w[o] = x;
    w[o + 1] = y;
    w[o + 2] = at;
    w[o + 3] = speed;
    this.shockSlot = (this.shockSlot + 1) % SHOCKWAVE.slots;
  }

  private roundText(total: number, chips: number): string {
    return `ラウンドの増減 ${formatSigned(total)}。手持ち ${formatScore(chips)}`;
  }

  /** 卓の状態（操作を待っている手の光、賭けの丸）を FxState へ書く */
  private writeTable(ft: FrameTime): void {
    const fx = this.o.fx;
    const count = this.hands.length;
    const active = this.active >= 0 && this.active < count ? this.hands[this.active] : null;
    this.activeShown = damp(this.activeShown, active ? 1 : 0, AIR.activeTau, ft.realDt);
    if (active) {
      handBounds(this.active, count, Math.max(1, active.slots.length), this.bounds);
      fx.activeX = this.bounds.x;
      fx.activeY = this.bounds.y;
      fx.activeHW = this.bounds.hw;
      fx.activeHH = this.bounds.hh;
    }
    fx.active = this.activeShown;
    const spots = fx.spots;
    for (let i = 0; i < MAX_HANDS; i++) {
      const o = i * 4;
      if (i < count && this.hands[i].bet.amount > 0) {
        betSpot(i, count, this.spot);
        spots[o] = this.spot.x;
        spots[o + 1] = this.spot.y;
        spots[o + 2] = this.spot.r;
        spots[o + 3] = 1;
      } else spots[o + 3] = 0;
    }
  }
}

/**
 * events の i 番目の出来事でカードを受けた手 hand（DEALER はディーラー）が、その後に引かずに合計が決まるか。
 * 出来事は操作を待つところまで決まっているので、続く出来事を先読みして決める。
 * - プレイヤーの手: 同じ手へ次のカードを配る前に、止める・バースト・ブラックジャック・決着が来れば決まる。分ける（番号がずれ、新しいカードを受ける）か、
 *   次のカードが来るか、先読みできる出来事が尽きたら（操作を待つ）決まっていない
 * - ディーラー: 次のカードを引く前に、引き終える・ブラックジャック・ラウンドの終わりが来れば決まる
 */
function handClosesAfter(events: readonly RoundEvent[], i: number, hand: number): boolean {
  for (let j = i + 1; j < events.length; j++) {
    const e = events[j];
    if (hand === DEALER) {
      if (e.t === 'deal' && e.hand === DEALER) return false;
      if (e.t === 'dealerStand' || e.t === 'dealerBust' || e.t === 'dealerNatural' || e.t === 'end') return true;
      continue;
    }
    if (e.t === 'split' && e.hand <= hand) return false;
    if (e.t === 'deal' && e.hand === hand) return false;
    if ((e.t === 'stand' || e.t === 'bust' || e.t === 'natural' || e.t === 'settle') && e.hand === hand) return true;
  }
  return false;
}

/** 合計の札を書く。合計が決まった手（done）は、ソフトでも A を 1 と数えた合計を添えない */
function writeLabel(out: HandLabel, faces: Faces, state: LabelState, done: boolean, x: number, y: number): void {
  out.shown = true;
  out.total = faces.total;
  out.soft = faces.soft && !done;
  out.state = state;
  out.x = x;
  out.y = y;
}

/** 賭けの額の札を書く */
function writeBet(out: BetLabel, amount: number, crowded: boolean, x: number, y: number, width: number): void {
  out.shown = true;
  out.amount = amount;
  out.crowded = crowded;
  out.x = x;
  out.y = y;
  out.width = width;
}
