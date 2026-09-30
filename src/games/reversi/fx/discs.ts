import { cellX, cellY } from '../geometry.ts';
import { hasSquare } from '../rules/bits.ts';
import type { Bits } from '../rules/bits.ts';
import { BLACK, discAt, SQUARES } from '../rules/position.ts';
import type { Color, Position } from '../rules/position.ts';
import type { PreviewFlip } from './choreo.ts';

/**
 * present の時間軸で「十分に過去」と「十分に先」を表す時刻。起きていない出来事の時刻にする。
 * シェーダーの uniform（f32）に入るので、経過時間の指数的な減衰が 0 になりきり、
 * かつシェーダーが足す 0.1 秒ほどの幅が f32 で丸め消えない桁にする（smoothstep の両端が同じ値になると、結果が決まらない）
 */
export const LONG_AGO = -1e4;
export const FAR_AHEAD = 1e6;

/** 石がどう落ちてきたか。落ち方の見た目を変える */
export const DropKind = {
  None: 0,
  Human: 1,
  Cpu: 2,
  /** 対局の始まりの初期配置 */
  Intro: 3,
} as const;
export type DropKind = (typeof DropKind)[keyof typeof DropKind];

/** 押している間の予告 */
const PreviewKind = {
  None: 0,
  /** 返る石を震わせる */
  Tremble: 1,
  /** 打とうとしているマスに、半透明の黒い石・白い石を置く */
  GhostBlack: 2,
  GhostWhite: 3,
} as const;
type PreviewKind = (typeof PreviewKind)[keyof typeof PreviewKind];

const NO_SQUARES: Readonly<Bits> = { hi: 0, lo: 0 };

/** 1 マスあたりの値の数（vec4 が 6 本） */
export const DISC_LANES = 6;
export const DISC_STRIDE = DISC_LANES * 4;

/**
 * 並び（マスごとに DISC_STRIDE 個）:
 * - 0: x, y（ワールド座標）, 返る前の色, 返った後の色（-1 は石なし、0 黒、1 白）
 * - 1: 返り始める時刻, 返りきるまでの長さ, 余分に回る周数, 浮く高さ
 * - 2: 返る向き x, y（予告で震える向きにも使う）, 落ち始める時刻, 落ち方（DropKind）
 * - 3: 移す前の位置 x, y, 移し始める時刻（終局で色ごとに並べ直すとき）, 空き
 * - 4: 合法手になった時刻, 合法手でなくなった時刻, 予告を始めた時刻, 確定石になった時刻
 * - 5: 予告の種類（PreviewKind）, 落ちて着くまでの長さ, 数えた時刻, 暗くし始めた時刻
 */
export const DISC_OFFSET = {
  x: 0,
  y: 1,
  from: 2,
  to: 3,
  flipStart: 4,
  flipDur: 5,
  spins: 6,
  lift: 7,
  dirX: 8,
  dirY: 9,
  dropStart: 10,
  dropKind: 11,
  moveFromX: 12,
  moveFromY: 13,
  moveStart: 14,
  legalSince: 16,
  legalUntil: 17,
  previewSince: 18,
  stableSince: 19,
  previewKind: 20,
  dropDur: 21,
  countedAt: 22,
  dimAt: 23,
} as const;

const O = DISC_OFFSET;

/**
 * 盤の 64 マスの石の見た目の状態。演出（ディレクター）が書き、描画（DiscsView）が版（version）の変わったときに写す。
 * 時刻はすべて present の時間軸（シェーダーの u.time）の秒。シェーダーが時刻から動きを計算するので、毎フレーム書く必要はない。
 *
 * shown は盤に見えている色で、返る石は返りきったときに変わる（HUD の石の数はこれを数える）。
 */
export class DiscField {
  readonly data = new Float32Array(SQUARES * DISC_STRIDE);
  /** 盤に見えている色（-1 は石なし） */
  readonly shown = new Int8Array(SQUARES);
  version = 0;
  private readonly legal = new Uint8Array(SQUARES);

  constructor() {
    for (let s = 0; s < SQUARES; s++) {
      const o = s * DISC_STRIDE;
      this.data[o + O.x] = cellX(s);
      this.data[o + O.y] = cellY(s);
    }
    this.clear();
  }

  /** 石も印もない盤にする */
  clear(): void {
    for (let s = 0; s < SQUARES; s++) this.resetSquare(s, -1);
    this.shown.fill(-1);
    this.legal.fill(0);
    this.version++;
  }

  /** 局面どおりに石を置く。動きはつけない */
  setPosition(p: Position): void {
    for (let s = 0; s < SQUARES; s++) {
      const c = discAt(p, s);
      this.resetSquare(s, c);
      this.shown[s] = c;
    }
    this.legal.fill(0);
    this.version++;
  }

  /** 時刻 at から duration かけて、色 color の石を落として置く。盤に見えるのは落ちきったとき（landed で知らせる） */
  drop(square: number, color: Color, at: number, duration: number, kind: DropKind): void {
    const d = this.data;
    const o = square * DISC_STRIDE;
    d[o + O.from] = color;
    d[o + O.to] = color;
    d[o + O.flipStart] = LONG_AGO;
    d[o + O.dropStart] = at;
    d[o + O.dropDur] = duration;
    d[o + O.dropKind] = kind;
    d[o + O.previewKind] = PreviewKind.None;
    this.legalOff(square, at);
    this.version++;
  }

  /** 石を返す。from の色で見えている石が、start から duration かけて to の色になる */
  flip(square: number, from: Color, to: Color, start: number, duration: number, spins: number, lift: number, dirX: number, dirY: number): void {
    const d = this.data;
    const o = square * DISC_STRIDE;
    d[o + O.from] = from;
    d[o + O.to] = to;
    d[o + O.flipStart] = start;
    d[o + O.flipDur] = duration;
    d[o + O.spins] = spins;
    d[o + O.lift] = lift;
    d[o + O.dirX] = dirX;
    d[o + O.dirY] = dirY;
    d[o + O.previewKind] = PreviewKind.None;
    this.version++;
  }

  /** 石が盤に着いた、または返りきった。盤に見える色を変える */
  landed(square: number, color: Color): void {
    this.shown[square] = color;
  }

  /** 色 c の、盤に見えている石の数 */
  countShown(c: Color): number {
    let n = 0;
    for (let s = 0; s < SQUARES; s++) if (this.shown[s] === c) n++;
    return n;
  }

  /**
   * 合法手の印。集合 legal のマスに印を出し、外れたマスの印を消す（空の集合ならすべて消す）。変わったマスだけ時刻を書く。
   * 印は出すときも消すときも、その時刻からフェードする
   */
  setLegal(legal: Readonly<Bits>, now: number): void {
    let changed = false;
    for (let s = 0; s < SQUARES; s++) {
      const on = hasSquare(legal.hi, legal.lo, s) ? 1 : 0;
      if (on === this.legal[s]) continue;
      this.legal[s] = on;
      const o = s * DISC_STRIDE;
      if (on) {
        this.data[o + O.legalSince] = now;
        this.data[o + O.legalUntil] = FAR_AHEAD;
      } else {
        this.data[o + O.legalUntil] = now;
      }
      changed = true;
    }
    if (changed) this.version++;
  }

  /** すべての合法手の印を、時刻 now から消す */
  clearLegal(now: number): void {
    this.setLegal(NO_SQUARES, now);
  }

  /**
   * 押している間の予告。square に半透明の color の石を置き、flips の石を向き (dirX, dirY)（ワールド座標）へ震わせる。
   * square が -1 なら予告を消す
   */
  preview(square: number, color: Color, flips: readonly PreviewFlip[], now: number): void {
    const d = this.data;
    for (let s = 0; s < SQUARES; s++) {
      const o = s * DISC_STRIDE;
      if (d[o + O.previewKind] !== PreviewKind.None) d[o + O.previewKind] = PreviewKind.None;
    }
    if (square >= 0) {
      const o = square * DISC_STRIDE;
      d[o + O.previewKind] = color === BLACK ? PreviewKind.GhostBlack : PreviewKind.GhostWhite;
      d[o + O.previewSince] = now;
      for (const f of flips) {
        const fo = f.square * DISC_STRIDE;
        d[fo + O.previewKind] = PreviewKind.Tremble;
        d[fo + O.previewSince] = now;
        d[fo + O.dirX] = f.dirX;
        d[fo + O.dirY] = f.dirY;
      }
    }
    this.version++;
  }

  /** 確定石になった。時刻 at から結晶のような光をまとう */
  stable(square: number, at: number): void {
    const o = square * DISC_STRIDE;
    if (this.data[o + O.stableSince] !== LONG_AGO) return;
    this.data[o + O.stableSince] = at;
    this.version++;
  }

  /**
   * 石を (fromX, fromY) から、マス to の位置へ移す（終局で色ごとに並べ直すとき）。石の色は color にする。
   * start までは (fromX, fromY) にあり、start から元の位置で消え、少し間を置いて to の位置に現れる。
   * 長さと区切りは config.ts の CEREMONY.warp で、描き方は view/discs.ts
   */
  gather(to: number, color: Color, fromX: number, fromY: number, start: number): void {
    const d = this.data;
    const o = to * DISC_STRIDE;
    this.resetSquare(to, color);
    d[o + O.moveFromX] = fromX;
    d[o + O.moveFromY] = fromY;
    d[o + O.moveStart] = start;
    this.shown[to] = color;
    this.version++;
  }

  /** マス square に色 color の石を、動きをつけずに置く */
  place(square: number, color: Color): void {
    this.resetSquare(square, color);
    this.shown[square] = color;
    this.version++;
  }

  /** 終局で数えた。時刻 at に脈打つ */
  counted(square: number, at: number): void {
    this.data[square * DISC_STRIDE + O.countedAt] = at;
    this.version++;
  }

  /** 時刻 at から暗くする（負けた側の石） */
  dim(square: number, at: number): void {
    this.data[square * DISC_STRIDE + O.dimAt] = at;
    this.version++;
  }

  private legalOff(square: number, at: number): void {
    if (!this.legal[square]) return;
    this.legal[square] = 0;
    this.data[square * DISC_STRIDE + O.legalUntil] = at;
  }

  /** マス s を、色 c の石が動かずに置かれた状態にする（-1 は石なし）。印と予告も消す */
  private resetSquare(s: number, c: number): void {
    const d = this.data;
    const o = s * DISC_STRIDE;
    d[o + O.from] = c;
    d[o + O.to] = c;
    d[o + O.flipStart] = LONG_AGO;
    d[o + O.flipDur] = 0.3;
    d[o + O.spins] = 0;
    d[o + O.lift] = 0;
    d[o + O.dirX] = 1;
    d[o + O.dirY] = 0;
    d[o + O.dropStart] = LONG_AGO;
    d[o + O.dropDur] = 0;
    d[o + O.dropKind] = DropKind.None;
    d[o + O.moveFromX] = d[o + O.x];
    d[o + O.moveFromY] = d[o + O.y];
    d[o + O.moveStart] = LONG_AGO;
    d[o + O.legalSince] = LONG_AGO;
    d[o + O.legalUntil] = LONG_AGO;
    d[o + O.previewSince] = LONG_AGO;
    d[o + O.stableSince] = LONG_AGO;
    d[o + O.previewKind] = PreviewKind.None;
    d[o + O.countedAt] = LONG_AGO;
    d[o + O.dimAt] = LONG_AGO;
  }
}
