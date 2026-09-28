import { clamp, lerp, ramp } from '../../../shared/math.ts';
import {
  BALL_CAP,
  BALL_RADIUS,
  BlockType,
  CELL_H,
  COLS,
  DANGER_Y,
  FIELD_H,
  FIELD_W,
  PADDLE_Y,
  BLOCK_INSET_Y,
  STEP_DT,
  snapshotTuning,
} from '../config.ts';
import type { SimConfig } from '../config.ts';
import { BallStore } from './balls.ts';
import type { ReadonlyBallStore } from './balls.ts';
import { BlockField, ROW_EPS, cellCenterX } from './blocks.ts';
import type { ReadonlyBlockField } from './blocks.ts';
import { Collider } from './collide.ts';
import type { BlockHitHandler } from './collide.ts';
import { Descent, descentRateAt } from './descent.ts';
import { EndlessRows } from './endless-rows.ts';
import { EventKind, EventQueue, Signal } from './events.ts';
import { Rng } from './rng.ts';
import { Scoring } from './scoring.ts';
import { parseStage } from './stage-parse.ts';
import type { StageDef } from './stage-parse.ts';

export type SimMode = { kind: 'endless' } | { kind: 'stage'; stage: StageDef };

/** 1 ステップぶんの入力。paddleTargetX が有限でなければ、パドルの目標は前のまま */
export type SimInput = { paddleTargetX: number; launch: boolean };

export type Phase = 'playing' | 'over' | 'cleared';

type SimOptions = { mode: SimMode; seed: number; config: SimConfig };

const R = BALL_RADIUS;
const DEG = Math.PI / 180;
/** 1 サブステップで進んでよい最大距離 */
const MAX_SUBSTEP_DIST = R * 0.5;
/** これより小さい 1 回の降下では、ボールの押し下げを省く。通常の衝突判定だけで十分に押し出せる */
const PUSH_MIN_DELTA = R * 0.05;
const PADDLE_VEL_TAU = 0.06;
/** パドルの速度を 1 ステップでどれだけ新しい値へ寄せるか */
const PADDLE_VEL_BLEND = 1 - Math.exp(-STEP_DT / PADDLE_VEL_TAU);
const EVENT_CAPACITY = 8192;
const STAGE_APPEAR_STAGGER = 0.03;
/** 開発用のボールの追加で、ブロックに重ならない位置を探す回数 */
const SPAWN_ATTEMPTS = 8;

/** タイトル画面の背景に使う、何も起きない sim の目印 */
const IDLE_MODE: SimMode = { kind: 'stage', stage: { id: 'idle', name: '', rows: [] } };


/** パドルの中心が動ける範囲。パドルの両端が壁の内側に収まる */
export function paddleRange(config: SimConfig): { min: number; max: number } {
  const half = config.paddle.width / 2;
  return { min: half, max: FIELD_W - half };
}

/**
 * ブロック崩しのゲームロジック本体。描画にも時刻にも依存せず、固定ステップ（STEP_DT）の `step()` だけで進む。
 * 同じシード・同じ調整値・同じ入力列なら、必ず同じ結果になる。
 *
 * 状態は読み取り専用で公開する。外から変えられるのは、入力（`step`）と、プレイが決着した後のボールの回収、
 * 壊れないブロックの破砕、ボールボーナスの加算（`collectBalls` / `shatterSolids` / `creditClearBonus`）だけ。
 */
export class Sim {
  readonly mode: SimMode;
  readonly config: SimConfig;
  /** ステップをまたいで溜まる。読む側がフレームごとに（ステップを進める前に）clear() する */
  readonly events = new EventQueue(EVENT_CAPACITY);

  private readonly ballStore = new BallStore();
  private readonly field = new BlockField();
  private readonly rng: Rng;
  private readonly collider: Collider;
  private readonly scoring: Scoring;
  private readonly descent = new Descent();
  private readonly rows: EndlessRows | null;
  private readonly idle: boolean;
  private readonly paddleMin: number;
  private readonly paddleMax: number;

  private _phase: Phase = 'playing';
  private _time = 0;
  private _activeTime = 0;
  private _speed: number;
  private _attached = true;
  private _lives: number;

  private _paddleX = FIELD_W / 2;
  private paddlePrevX = FIELD_W / 2;
  private paddleTargetX = FIELD_W / 2;
  /** パドルの速度（u/s）。発射角の傾きに使う */
  private paddleVel = 0;

  /** 最後に壊したブロックの中心。ステージクリアと全消しの位置として知らせる */
  private lastBreakX = FIELD_W / 2;
  private lastBreakY = FIELD_H / 2;

  constructor(opts: SimOptions) {
    const cfg = opts.config;
    this.mode = opts.mode;
    this.config = cfg;
    this.idle = opts.mode === IDLE_MODE;
    const range = paddleRange(cfg);
    this.paddleMin = range.min;
    this.paddleMax = range.max;
    this.rng = new Rng(opts.seed);
    this.scoring = new Scoring(cfg.score);
    const handler: BlockHitHandler = {
      onBlockHit: (idx, row, col, dirX, dirY, hitX, hitY) => this.hitBlock(idx, row, col, dirX, dirY, hitX, hitY),
    };
    this.collider = new Collider(this.ballStore, this.field, this.events, cfg, handler);
    this._speed = cfg.ball.speedStart;
    this._lives = opts.mode.kind === 'stage' ? cfg.stage.lives : 0;
    this.rows = opts.mode.kind === 'endless' ? new EndlessRows(cfg.endless, this.rng) : null;
    if (this.idle) return;
    if (opts.mode.kind === 'endless') {
      const rows = cfg.endless.initialRows;
      this.fillEndlessRows(rows, FIELD_H - rows * CELL_H);
    } else {
      this.loadStage(opts.mode.stage);
    }
  }

  /** ブロックもボールもなく、step() しても何も変わらない sim。タイトル画面の背景に使う */
  static idle(): Sim {
    return new Sim({ mode: IDLE_MODE, seed: 0, config: snapshotTuning() });
  }

  get balls(): ReadonlyBallStore {
    return this.ballStore;
  }

  get blocks(): ReadonlyBlockField {
    return this.field;
  }

  get phase(): Phase {
    return this._phase;
  }

  /** ボールが動いているか。決着した後は、決着したステップの位置で止まる */
  get ballsMoving(): boolean {
    return this._phase === 'playing';
  }

  /** sim の経過時間（秒） */
  get time(): number {
    return this._time;
  }

  /** ボールが飛んでいた時間の合計。難易度の進行に使う */
  get activeTime(): number {
    return this._activeTime;
  }

  /** 全ボール共通の速さ（u/s） */
  get speed(): number {
    return this._speed;
  }

  get paddleX(): number {
    return this._paddleX;
  }

  get paddleWidth(): number {
    return this.config.paddle.width;
  }

  /** ボールがパドルに乗って発射を待っている */
  get attached(): boolean {
    return this._attached;
  }

  /** 発射前にパドルへ乗っているボールの中心 */
  get attachedBallY(): number {
    return PADDLE_Y + this.config.paddle.height / 2 + R;
  }

  get lives(): number {
    return this._lives;
  }

  get score(): number {
    return this.scoring.score;
  }

  get chain(): number {
    return this.scoring.chain;
  }

  get chainMultiplier(): number {
    return this.scoring.multiplier;
  }

  get ballCount(): number {
    return this.ballStore.count;
  }

  /** ステージクリアの時点で残っていたボールのうち、まだボールボーナスとして得点にしていない数 */
  get clearBonusRemaining(): number {
    return this.scoring.clearBonusRemaining;
  }

  /**
   * 1 ステップ（STEP_DT 秒）進める。
   * launch は、このステップを進める前のパドルの位置と速度で打ち出す（乗っていなければ何もしない）。
   */
  step(input: SimInput): void {
    if (this.idle) return;
    const dt = STEP_DT;
    this.events.time = this._time + dt;
    if (input.launch) this.launch();
    this._time += dt;
    const tx = input.paddleTargetX;
    if (Number.isFinite(tx)) this.paddleTargetX = clamp(tx, this.paddleMin, this.paddleMax);
    this.updatePaddle(dt);
    this.collider.hits.reset();

    if (this._phase === 'playing') {
      if (!this._attached) this._activeTime += dt;
      const b = this.config.ball;
      this._speed = lerp(b.speedStart, b.speedMax, ramp(this._activeTime, b.speedRampSeconds));
      if (this.mode.kind === 'endless') this.stepDescent(dt);
    }

    if (this._phase === 'playing') this.stepBalls(dt);
    else this.ballStore.hold();

    this.scoring.decay(this._time);
    if (this._phase === 'playing') this.checkRules();
  }

  /**
   * 決着した後（ゲームオーバーやステージクリアの演出）に、条件に合うボールを取り除く。
   * 取り除いたボールの位置で onCollected を呼び、取り除いた数を返す。プレイ中は何もしない。
   */
  collectBalls(pred: (x: number, y: number) => boolean, onCollected: (x: number, y: number) => void): number {
    if (this._phase === 'playing') return 0;
    const b = this.ballStore;
    let removed = 0;
    for (let i = 0; i < b.count; i++) {
      if (!pred(b.x[i], b.y[i])) continue;
      b.dead[i] = 1;
      onCollected(b.x[i], b.y[i]);
      removed++;
    }
    if (removed > 0) b.compact();
    return removed;
  }

  /**
   * 決着した後（ステージクリアのフィナーレ）に、中心が条件に合う壊れないブロックを取り除く。
   * 取り除いたブロックの中心で onShattered を呼び、取り除いた数を返す。得点は変えない。プレイ中は何もしない。
   */
  shatterSolids(pred: (x: number, y: number) => boolean, onShattered: (x: number, y: number) => void): number {
    if (this._phase === 'playing') return 0;
    const f = this.field;
    let removed = 0;
    for (let row = 0; row < f.rowCount; row++) {
      const base = f.slotOf(row) * COLS;
      const cy = f.centerY(row);
      for (let col = 0; col < COLS; col++) {
        const idx = base + col;
        if (f.type[idx] !== BlockType.Solid) continue;
        const cx = cellCenterX(col);
        if (!pred(cx, cy)) continue;
        f.removeAt(idx);
        onShattered(cx, cy);
        removed++;
      }
    }
    return removed;
  }

  /** ステージクリアのボールボーナスを n 個ぶん（残りが少なければ残りの分だけ）得点にする。得点にした数を返す */
  creditClearBonus(n: number): number {
    return this.scoring.creditClearBonus(n);
  }

  /**
   * 開発用: ボールを n 個まで足す（性能の計測に使う）。パドルに乗っているボールはそのまま。
   * 位置と向きは sim の乱数で決め、ブロックに重なる位置には置かない。
   */
  debugSpawnBalls(n: number): void {
    if (this.idle || this._phase !== 'playing') return;
    const b = this.ballStore;
    const rng = this.rng;
    const count = Math.max(0, Math.floor(n));
    for (let k = 0; k < count && b.count < BALL_CAP; k++) {
      for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
        const x = rng.range(R + 0.2, FIELD_W - R - 0.2);
        const y = rng.range(PADDLE_Y + 0.5, PADDLE_Y + 2.5);
        if (this.collider.overlapsBlock(x, y)) continue;
        const a = rng.range(0.35, Math.PI - 0.35);
        const i = b.add(x, y, Math.cos(a), Math.sin(a));
        this.collider.clampAngle(i);
        break;
      }
    }
  }

  private launch(): void {
    if (!this._attached || this._phase !== 'playing') return;
    const p = this.config.paddle;
    const tilt = clamp(this.paddleVel / p.launchTiltFullSpeed, -1, 1) * p.launchTiltMaxDeg * DEG;
    const y = this.attachedBallY;
    const i = this.ballStore.add(this._paddleX, y, Math.sin(tilt), Math.cos(tilt));
    if (i < 0) return;
    this.collider.clampAngle(i);
    this._attached = false;
    this.events.push(EventKind.Launch, this._paddleX, y, 0, 0);
  }

  private updatePaddle(dt: number): void {
    this.paddlePrevX = this._paddleX;
    this._paddleX = this.paddleTargetX;
    const v = (this._paddleX - this.paddlePrevX) / dt;
    this.paddleVel += (v - this.paddleVel) * PADDLE_VEL_BLEND;
    this.collider.setPaddle(this.paddlePrevX, this._paddleX);
  }

  /**
   * エンドレスの降下。ブロックは連続的には動かさず、降下速度ぶんの量が溜まるたびに 1 段ずつ一気に落とす。
   * 段が落ちた瞬間に次の行が天井の外から入ってくるので、「いま画面にあるブロック」の境目がはっきりする。
   * ボールがパドルに乗っている間は溜めない（落ちている途中の段はそのまま着地させる）。
   */
  private stepDescent(dt: number): void {
    const e = this.config.endless;
    const rows = this._attached ? 0 : descentRateAt(e, this._activeTime) * dt;
    const r = this.descent.advance(dt, rows, CELL_H, e.stepDropSeconds);
    this.moveFieldDown(r.delta);
    this.field.pruneEmptyBottomRows();
    if (r.penaltyLanded) this.events.signal(Signal.PenaltyLanded);
    if (r.stepLanded) this.events.signal(Signal.StepLanded);
    if (r.refillLanded) this.events.signal(Signal.RefillLanded);
  }

  /**
   * ブロック全体を delta だけ下げる。
   * 大きく動くときは小刻みに分けて、降りてくるブロックの下にいるボールを押し下げる。
   * こうしないと、落下の速いペナルティや補充で、ブロックがボールを飲み込んでしまう。
   */
  private moveFieldDown(delta: number): void {
    let remaining = delta;
    while (remaining > 0) {
      const d = remaining > MAX_SUBSTEP_DIST ? MAX_SUBSTEP_DIST : remaining;
      remaining -= d;
      this.field.shiftDown(d);
      this.generateRowsAboveCeiling();
      if (d > PUSH_MIN_DELTA) this.collider.pushBelowDescending(d);
    }
  }

  /**
   * 天井の上に、常に 1 行ぶんの予備の行を置いておく。
   * 行は必ず天井の外から降りてくるので、見える範囲に突然ブロックが現れることはない。
   */
  private generateRowsAboveCeiling(): void {
    const f = this.field;
    const rows = this.rows;
    if (!rows) return;
    while (f.rowCount > 0 && f.topRowBottomY() < FIELD_H - ROW_EPS) {
      rows.fill(f, f.pushRowTop(), this._activeTime, this._time);
    }
  }

  private fillEndlessRows(count: number, lowestRowY: number): void {
    const f = this.field;
    const rows = this.rows;
    if (!rows) return;
    f.clearAll();
    f.placeAt(lowestRowY);
    for (let i = 0; i < count; i++) rows.fill(f, f.pushRowTop(), this._activeTime, this._time);
    this.generateRowsAboveCeiling();
  }

  private loadStage(stage: StageDef): void {
    const parsed = parseStage(stage);
    const f = this.field;
    f.clearAll();
    f.placeAt(FIELD_H - parsed.rowCount * CELL_H);
    for (let r = parsed.rowCount - 1; r >= 0; r--) {
      const row = f.pushRowTop();
      // 出現時刻を上の行から少しずつずらし、開始時に上から順に現れるようにする（見た目だけに使う値）
      const born = r * STAGE_APPEAR_STAGGER;
      for (let col = 0; col < COLS; col++) {
        const i = r * COLS + col;
        const type = parsed.type[i] as BlockType;
        if (type !== BlockType.Empty) f.setCell(row, col, type, parsed.hp[i], born);
      }
    }
  }

  private stepBalls(dt: number): void {
    const b = this.ballStore;
    const n = b.count;
    if (n === 0) return;
    const c = this.collider;
    const dist = this._speed * dt;
    const sub = Math.max(1, Math.ceil(dist / MAX_SUBSTEP_DIST));
    const h = dist / sub;
    let anyDead = false;
    for (let i = 0; i < n; i++) {
      b.px[i] = b.x[i];
      b.py[i] = b.y[i];
      for (let s = 0; s < sub; s++) {
        b.x[i] += b.dx[i] * h;
        b.y[i] += b.dy[i] * h;
        c.walls(i);
        c.blocks(i);
        c.paddle(i);
        if (b.y[i] < -R) {
          b.dead[i] = 1;
          anyDead = true;
          // イベントの時刻（ステップの終わり）の位置にそろえるため、残りのサブステップぶん進めた位置で知らせる
          const rest = (sub - s - 1) * h;
          const v = this._speed;
          this.events.push(EventKind.Drain, b.x[i] + b.dx[i] * rest, b.y[i] + b.dy[i] * rest, b.dx[i] * v, b.dy[i] * v);
          break;
        }
      }
    }
    if (anyDead) b.compact();
  }

  /**
   * ブロックに当たった。壊れたら、当てたボールが跳ね返った向き（dirX, dirY）を中心に、扇状にボールを出す（分裂）。
   * 下から当てると新しいボールはパドル側へ降ってくるので、拾わないと増えない。
   * 裏に回り込んで上面に当てると上へ飛び、天井とブロックの間で爆発的に増える。
   * 壊れないブロックは跳ね返すだけ。当たった点（hitX, hitY）は、壊れないブロックに当たったときと壊れたときに知らせる。
   */
  private hitBlock(idx: number, row: number, col: number, dirX: number, dirY: number, hitX: number, hitY: number): void {
    const f = this.field;
    f.markHit(idx, this._time);
    const type = f.type[idx] as BlockType;
    if (type === BlockType.Empty) return;
    if (type === BlockType.Solid) {
      this.events.push(EventKind.SolidHit, hitX, hitY, dirX, dirY);
      return;
    }
    const cx = cellCenterX(col);
    const cy = f.centerY(row);
    const maxHp = f.maxHp[idx];
    const hp = f.damageAt(idx);
    if (hp > 0) {
      this.events.push(EventKind.HardHit, cx, cy, hp, maxHp);
      return;
    }

    const chain = this.scoring.onBreak(this._time, type, maxHp);
    this.events.push(EventKind.BlockBreak, cx, cy, type, chain, hitX, hitY);
    this.lastBreakX = cx;
    this.lastBreakY = cy;

    const bl = this.config.blocks;
    const spawn = type === BlockType.Mega ? bl.ballsFromMega : type === BlockType.Hard ? bl.ballsFromHard : bl.ballsFromBall;
    const spread = (type === BlockType.Mega ? bl.megaSpreadDeg : bl.spreadDeg) * DEG;
    const center = Math.atan2(dirY, dirX);
    for (let k = 0; k < spawn; k++) {
      // 複数出すときは扇を等分し、それぞれの区画の中で少し揺らす
      const slot = (2 * spread) / spawn;
      const a = center - spread + slot * (k + this.rng.next());
      this.spawnBall(cx, cy, Math.cos(a), Math.sin(a));
    }
  }

  private spawnBall(x: number, blockCenterY: number, dx: number, dy: number): void {
    // 天井にかかっているブロックの中心は天井より上にあるので、出現位置はフィールドの内側に収める
    const y = Math.min(blockCenterY, FIELD_H - R);
    const i = this.ballStore.add(x, y, dx, dy);
    if (i < 0) {
      this.scoring.onOverflow();
      this.events.push(EventKind.Overflow, x, y, 0, 0);
      return;
    }
    this.collider.clampAngle(i);
  }

  private checkRules(): void {
    const f = this.field;
    const ev = this.events;
    const e = this.config.endless;

    if (this.mode.kind === 'stage') {
      if (f.breakableCount === 0) {
        this._phase = 'cleared';
        this.scoring.startClearBonus(this.ballStore.count);
        ev.signalAt(Signal.StageClear, this.lastBreakX, this.lastBreakY);
        return;
      }
    } else if (!this.descent.refilling && f.liveCountBelow(FIELD_H - BLOCK_INSET_Y) === 0) {
      // 矩形がまだ天井の上にある行（予備の行）は数えない。補充する行は天井の外に置き、落下させて入れる
      ev.signalAt(Signal.AllClear, this.lastBreakX, this.lastBreakY);
      this.fillEndlessRows(e.refillRows, FIELD_H);
      this.descent.startRefill(e.refillRows * CELL_H, e.refillDropSeconds);
    }

    if (!this._attached && this.ballStore.count === 0) {
      ev.signal(Signal.BallsZero);
      if (this.mode.kind === 'endless') {
        this.descent.startPenalty(e.penaltyRows * CELL_H, e.penaltyDropSeconds);
        this._attached = true;
      } else {
        this._lives--;
        if (this._lives > 0) {
          this._attached = true;
          ev.signal(Signal.LifeLost);
        } else {
          this._phase = 'over';
          ev.signal(Signal.GameOver);
          return;
        }
      }
    }

    if (this.mode.kind === 'endless' && f.lowestLiveBlockBottom() <= DANGER_Y) {
      this._phase = 'over';
      ev.signal(Signal.GameOver);
    }
  }
}
