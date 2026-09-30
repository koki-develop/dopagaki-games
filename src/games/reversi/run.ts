import type { ParticleSink } from '../../engine/particle-spec.ts';
import type { LayeredBgm } from '../../juice/audio/bgm.ts';
import type { AudioEngine, VoiceGroup } from '../../juice/audio/engine.ts';
import { CameraRig } from '../../juice/camera.ts';
import type { FlashLimiter } from '../../juice/flash.ts';
import type { FrameTime } from '../../juice/frame-time.ts';
import { WorldClock } from '../../juice/time.ts';
import { Rng } from '../../shared/rng.ts';
import { chooseMove } from './ai/cpu.ts';
import { Combo, feverLevel } from './combo.ts';
import { CAMERA_RIG, MIN_THINK } from './config.ts';
import { choreograph, NO_FLIPS, previewFlips } from './fx/choreo.ts';
import { Director } from './fx/director.ts';
import type { HumanMove } from './fx/director.ts';
import { DiscField } from './fx/discs.ts';
import { createFxState } from './fx/fx-state.ts';
import type { FxState } from './fx/fx-state.ts';
import { Match } from './match.ts';
import { BLACK, BOARD_SIZE, colOf, initialPosition, rowOf, SQUARES, squareName, squareOf, squaresOf } from './rules/position.ts';
import type { MoveOutcome, Position } from './rules/position.ts';
import { finalSheet, ScoreKeeper } from './scoring.ts';
import { ReversiSfx } from './sounds/sfx.ts';
import { StableTracker } from './stable-tracker.ts';
import type { Callout, HudState, MatchSetup, RunResult, Side } from './types.ts';

/** run を捨てるときに、鳴っている効果音を消す時間（秒） */
const DISPOSE_FADE = 0.05;

/** セッションが持ち、プレイをまたいで使い回すもの */
export type RunServices = {
  audio: AudioEngine;
  bgm: LayeredBgm;
  flashes: FlashLimiter;
  particles: ParticleSink;
  vibrate(pattern: number | readonly number[]): void;
  /** 盤の上に文字を出す（位置はワールド座標） */
  callout(c: Callout): void;
  /** スクリーンリーダーに読み上げさせる */
  announce(text: string): void;
  /** 今の時刻（秒）。入力の押した時刻と同じ時間軸 */
  inputNow(): number;
};

type RunOptions = {
  id: number;
  setup: MatchSetup;
  /** 始める局面。開発用の操作口だけが渡し、渡した対局は練習として記録に残さない。null なら初期配置 */
  start: Position | null;
  /** これまでの最高スコア（記録がなければ 0） */
  bestScore: number;
  seed: number;
  /** このプレイが始まったときのセッションの実時間（秒）と、present の時刻。present = presentOffset + 世界時間 */
  real: number;
  presentOffset: number;
  services: RunServices;
};

/**
 * 対局の段階。
 * - intro: 始まりの演出
 * - humanTurn: 人の手番。コンボの窓を開けて、人の入力を待つ
 * - cpuTurn: CPU の手番。手を選び、最短の思考時間（実時間、since から）を待って square に打つ
 * - move: 着手の演出
 * - pass: パスの表示
 * - ending: 終局の儀式
 * - done: 結果が確定した
 */
type Stage =
  | { readonly k: 'intro'; readonly until: number }
  | { readonly k: 'humanTurn' }
  | { readonly k: 'cpuTurn'; readonly since: number; readonly square: number }
  | { readonly k: 'move'; readonly until: number; readonly outcome: MoveOutcome }
  | { readonly k: 'pass'; readonly until: number }
  | { readonly k: 'ending' }
  | { readonly k: 'done' };

const HUMAN_TURN: Stage = { k: 'humanTurn' };

/** プレイの節目。セッションがフレームの終わりに読み、状態と画面へ反映する。一度書いた値は変わらない */
type RunSignals = {
  /** 終局した時刻（秒、RunServices.inputNow の時間軸）。まだなら NaN */
  endingAt: number;
  /** 結果が確定した。まだなら null */
  finished: RunResult | null;
};

const SIDE_NAME: Readonly<Record<Side, string>> = { human: 'あなた', cpu: 'CPU' };

/**
 * 1 回の対局。start のたびに作り直し、使い終わったら捨てる。途中の状態を初期値へ戻す操作は持たない。
 * 対局の進行（Match）・コンボ・得点・確定石・世界の時計・カメラ・演出の状態・効果音・演出ディレクターをまとめて持つ。
 */
export class Run {
  readonly id: number;
  readonly match: Match;
  readonly camera = new CameraRig(CAMERA_RIG);
  readonly fx: FxState = createFxState();
  readonly discs = new DiscField();
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
  private readonly rng: Rng;
  private readonly ft: FrameTime;
  private stage: Stage;
  private readonly combo = new Combo();
  private readonly score = new ScoreKeeper();
  private readonly stable = new StableTracker();
  /** 終局したときに決めた結果。儀式と、確定の知らせが同じものを使う */
  private result: RunResult | null = null;
  /** 人が押している・ホバーしているマスと、キーボードのカーソル（-1 はなし） */
  private pointerSquare = -1;
  private cursor = -1;
  private disposed = false;

  constructor(opts: RunOptions) {
    this.id = opts.id;
    this.presentOffset = opts.presentOffset;
    this.practice = opts.start !== null;
    this.bestScore = opts.bestScore;
    this.services = opts.services;
    this.signals = this.sig;
    this.rng = new Rng(opts.seed);
    const start = opts.start ?? initialPosition();
    this.match = new Match(opts.setup, start);
    this.ft = { realDt: 0, worldDt: 0, real: opts.real, world: 0, present: opts.presentOffset };
    this.hud = {
      runId: opts.id,
      human: opts.setup.human,
      black: 0,
      white: 0,
      score: 0,
      newBest: false,
      comboWindow: 0,
      fever: 0,
    };
    this.group = opts.services.audio.createGroup();
    const services = opts.services;
    this.director = new Director({
      human: opts.setup.human,
      clock: this.clock,
      camera: this.camera,
      fx: this.fx,
      discs: this.discs,
      bestScore: opts.bestScore,
      presentOffset: opts.presentOffset,
      ports: {
        sfx: new ReversiSfx(services.audio, this.group),
        bgm: services.bgm,
        audio: services.audio,
        particles: services.particles,
        flashes: services.flashes,
        vibrate: (p) => services.vibrate(p),
        callout: (c) => {
          if (!this.disposed) services.callout(c);
        },
      },
    });
    this.stage = { k: 'intro', until: this.director.intro(start, this.stable.record(start), this.ft) };
    this.writeHud();
  }

  /** 最後に advance() したフレームの時刻。世界を進めないフレーム（一時停止中など）の描画にも、この値をそのまま使う */
  get frameTime(): Readonly<FrameTime> {
    return this.ft;
  }

  /** 人の手番で、打てる状態か */
  get humanTurn(): boolean {
    return this.stage.k === 'humanTurn';
  }

  /** 手番の側（人は打てる状態、CPU は考えている状態）。演出の間と対局の前後は null */
  get activeSide(): Side | null {
    return this.stage.k === 'humanTurn' ? 'human' : this.stage.k === 'cpuTurn' ? 'cpu' : null;
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

  /** 押している・ホバーしているマス（-1 は盤の外か、離した） */
  point(square: number): void {
    if (this.disposed || square === this.pointerSquare) return;
    this.pointerSquare = square;
    this.refreshPointer();
  }

  /** 指やマウスを離した。人の手番で、打てるマスなら打つ。打てないマスなら知らせる */
  release(square: number): void {
    this.pointerSquare = -1;
    if (this.disposed || !this.humanTurn) {
      this.refreshPointer();
      return;
    }
    if (square >= 0 && this.match.canPlay(square)) this.play(square);
    else {
      if (square >= 0) this.director.rejected();
      this.refreshPointer();
    }
  }

  /** キーボードのカーソルを動かす。最初の 1 回は、人が打てる最初のマス（なければ盤の中央）に出す */
  moveCursor(dx: number, dy: number): void {
    if (this.disposed) return;
    if (this.cursor < 0) {
      const legal = this.humanTurn ? squaresOf(this.match.legalMoves()) : [];
      this.cursor = legal.length > 0 ? legal[0] : squareOf(3, 3);
    } else {
      const c = Math.min(BOARD_SIZE - 1, Math.max(0, colOf(this.cursor) + dx));
      const r = Math.min(BOARD_SIZE - 1, Math.max(0, rowOf(this.cursor) + dy));
      this.cursor = squareOf(c, r);
    }
    this.director.setCursor(this.cursor);
    this.refreshPointer();
  }

  /** キーボードで決めた。カーソルのマスに打つ */
  confirm(): void {
    if (this.disposed || this.cursor < 0) return;
    this.release(this.cursor);
  }

  /** 終局の儀式をタップで飛ばす。飛ばせたら true（結果は次の advance を待たずに signals.finished へ入る） */
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
        if (ft.world >= s.until) this.startTurn(ft, false);
        return;
      case 'humanTurn': {
        if (this.combo.expire(ft.world) > 0) this.comboChanged(true);
        return;
      }
      case 'cpuTurn':
        if (ft.real - s.since >= MIN_THINK) this.play(s.square);
        return;
      case 'move':
        if (ft.world >= s.until) this.afterMove(s.outcome, ft);
        return;
      case 'pass':
        if (ft.world >= s.until) this.startTurn(ft, true);
        return;
      case 'ending':
      case 'done':
        return;
    }
  }

  /** 手番の側の手番を始める。quickable は、人の手番なら早打ちを数えるか（始まりの演出の後の最初の手番は false） */
  private startTurn(ft: FrameTime, quickable: boolean): void {
    const side = this.match.turn;
    if (!side) return;
    this.director.setTurn(side);
    if (side === 'human') {
      this.stage = HUMAN_TURN;
      this.combo.start(ft.world, quickable);
      this.director.showLegal(this.match.legalMoves(), ft);
      this.refreshPointer();
      return;
    }
    this.stage = { k: 'cpuTurn', since: ft.real, square: chooseMove(this.match.position, this.rng) };
  }

  /** 手番の側が square に打つ。演出を始める */
  private play(square: number): void {
    const ft = this.ft;
    const side = this.match.turn;
    if (!side) return;
    const outcome = this.match.play(square);
    const c = choreograph(outcome, side);
    const gained = this.stable.record(outcome.position);
    this.pointerSquare = -1;
    let human: HumanMove | null = null;
    if (side === 'human') {
      const before = this.combo.count;
      const hit = this.combo.hit(ft.world);
      const combo = this.combo.count;
      const mine = this.match.setup.human === BLACK ? gained.black : gained.white;
      const score = this.score.add(outcome, mine.length, combo, hit.quick);
      human = { combo, fever: feverLevel(combo), score, total: this.score.total };
      this.comboChanged(!hit.continued && before > 0);
    }
    const until = this.director.move(outcome, c, gained, ft, human);
    this.stage = { k: 'move', until, outcome };
    this.services.announce(`${SIDE_NAME[side]}: ${squareName(square)}、${c.count} 枚返しました`);
  }

  private afterMove(outcome: MoveOutcome, ft: FrameTime): void {
    if (outcome.over) {
      this.startEnding(ft);
      return;
    }
    if (outcome.passed !== null) {
      const who = this.match.sideOf(outcome.passed);
      // 人がパスしたらコンボは途切れる
      if (who === 'human' && this.combo.pass() > 0) this.comboChanged(true);
      const until = this.director.pass(who, ft);
      this.services.announce(`${SIDE_NAME[who]}は打てる場所がないのでパスしました`);
      // CPU のパスは待たずに人の手番を始める（パスの表示の間にコンボの窓を削らない）
      if (who === 'cpu') this.startTurn(ft, true);
      else this.stage = { k: 'pass', until };
      return;
    }
    this.startTurn(ft, true);
  }

  /** 終局した。結果を決め、コンボとフィーバーを閉じて、終局の儀式を始める */
  private startEnding(ft: FrameTime): void {
    const verdict = this.match.verdict();
    const maxCombo = this.combo.best;
    // フルコンボは、盤が全部埋まるまで一度も途切れなかったときだけ
    const fullCombo = this.combo.unbroken && verdict.human + verdict.cpu === SQUARES;
    const score = finalSheet({
      moves: this.score.moves,
      quick: this.score.quick,
      discs: verdict.human,
      won: verdict.outcome === 'win',
      perfect: verdict.perfect,
      maxCombo,
      fullCombo,
    });
    const result: RunResult = {
      ...verdict,
      maxCombo,
      fullCombo,
      quickCount: this.score.quickCount,
      score,
      newBest: this.bestScore > 0 && score.total > this.bestScore,
      practice: this.practice,
    };
    this.result = result;
    this.combo.close();
    this.director.ending(result, ft);
    this.stage = { k: 'ending' };
    this.sig.endingAt = this.services.inputNow();
    const text = result.outcome === 'win' ? '勝ちです' : result.outcome === 'lose' ? '負けです' : '引き分けです';
    this.services.announce(`終局。あなた ${result.human}、CPU ${result.cpu}。${text}`);
  }

  /** 結果が確定した */
  private finish(): void {
    this.stage = { k: 'done' };
    this.sig.finished = this.result;
  }

  /** 押している・ホバーしているマスとカーソルから、予告を出し直す（人の手番だけ） */
  private refreshPointer(): void {
    const ft = this.ft;
    const square = this.pointerSquare >= 0 ? this.pointerSquare : this.cursor;
    if (!this.humanTurn || square < 0) {
      this.director.setPointer(-1, false, NO_FLIPS, ft);
      return;
    }
    const legal = this.match.canPlay(square);
    this.director.setPointer(square, legal, legal ? previewFlips(this.match.position, square) : NO_FLIPS, ft);
  }

  /** コンボが変わった（積んだ、途切れた、数え直した）。フィーバーの強さを演出へ渡し、積んでいたコンボが途切れたら知らせる */
  private comboChanged(broken: boolean): void {
    this.director.setFever(feverLevel(this.combo.count));
    if (broken) this.director.comboBroken();
  }

  private writeHud(): void {
    const h = this.hud;
    this.director.hud(h);
    // ゲージは、積んだコンボを次へつなぐ窓だけを見せる（コンボがなければ出さない）
    h.comboWindow = this.combo.count > 0 ? this.combo.remaining(this.ft.world) : 0;
    h.fever = feverLevel(this.combo.count);
  }
}
