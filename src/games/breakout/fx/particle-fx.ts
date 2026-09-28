import { FIELD_H, FIELD_W } from '../config.ts';
import { blockRgb, HARD_RGB, neonRgb, SOLID_RGB } from '../view/palette.ts';
import { DebrisFx } from './debris.ts';
import type { DebrisSink } from './debris.ts';
import { ParticleShape } from './particle-shape.ts';
import type { ParticleSpec } from './particle-shape.ts';

/** now は present の時間軸（シェーダーの u.time）の秒 */
export type ParticleSink = { emit(now: number, spec: ParticleSpec): void };

/** 光の筋の色。スコアの数字と同じ白に近い金 */
const STREAK_RGB = [1.6, 1.45, 0.9] as const;
const TAU = 6.28318;

/**
 * 演出の粒と破片を出す。色はすべて引数で受け取るか、そのメソッドの中で決める。
 * 発生の条件を書き込むオブジェクトは 1 つを使い回し、粒を出すたびにオブジェクトを作らない。
 * 時刻 now はすべて present の時間軸。
 */
export class ParticleFx {
  private readonly particles: ParticleSink;
  private readonly debris: DebrisFx;
  private readonly p: ParticleSpec = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    size0: 0,
    size1: 0,
    r: 0,
    g: 0,
    b: 0,
    shape: ParticleShape.Dot,
    gravity: 0,
    drag: 0,
    targetX: 0,
    targetY: 0,
  };
  /** メソッドの中で色を計算するための作業領域。メソッドをまたいで値を持ち越さない */
  private readonly c: [number, number, number] = [0, 0, 0];
  /** HUD のスコアの位置（ワールド座標）。得点に変わった光の筋が吸い込まれる先 */
  private anchorX = 1.2;
  private anchorY = FIELD_H + 1;

  constructor(particles: ParticleSink, debris: DebrisSink) {
    this.particles = particles;
    this.debris = new DebrisFx(debris);
  }

  setAnchor(x: number, y: number): void {
    this.anchorX = x;
    this.anchorY = y;
  }

  /** ブロックが壊れる: 光の点と火花。色はブロックの中心の縁の色 */
  blockBreak(now: number, x: number, y: number, type: number, budget: number): void {
    const c = blockRgb(type, y / FIELD_H, 0, now, this.c);
    const r = c[0];
    const g = c[1];
    const b = c[2];
    this.emit(now, x, y, 0, 0, 0.16, 0.35, 0.8, r * 1.4, g * 1.4, b * 1.4, ParticleShape.Dot, 0, 0);
    this.sparks(now, x, y, r * 1.6, g * 1.6, b * 1.6, 5, 6, budget, Number.NaN);
  }

  /**
   * 中心 (x, y) のブロック（種類 type）を、点 (fromX, fromY) から力を受けて破片に割る（`DebrisFx.shatter`）。
   * 出せる破片の数が足りなければ割らない
   */
  shatter(now: number, x: number, y: number, type: number, fromX: number, fromY: number, budget: number): void {
    this.debris.shatter(now, x, y, type, fromX, fromY, budget);
  }

  /** ボール大量ブロックが弾ける: 2 重の輪と 3 色の火花。hue は背景の色相のずれ（ラジアン） */
  megaBurst(now: number, x: number, y: number, hue: number, budget: number): void {
    const c = neonRgb(hue / TAU + Math.random(), this.c);
    this.ring(now, x, y, 0.3, 3.2, 0.55, 1.4, 1.3, 1.1);
    this.ring(now, x, y, 0.2, 2.0, 0.4, c[0] * 1.5, c[1] * 1.5, c[2] * 1.5);
    for (let k = 0; k < 3; k++) {
      neonRgb(hue / TAU + k * 0.33 + Math.random() * 0.1, c);
      this.sparks(now, x, y, c[0] * 1.7, c[1] * 1.7, c[2] * 1.7, 8, 9, budget, Number.NaN);
    }
  }

  /** ハードに当たった火花 */
  hardSparks(now: number, x: number, y: number, budget: number): void {
    this.sparks(now, x, y - 0.2, HARD_RGB[0], HARD_RGB[1], HARD_RGB[2], 3, 3.5, budget, Number.NaN);
  }

  /** 壊れないブロックに当たった火花。当たった点から、跳ね返ったボールの向き（dirX, dirY）へ散らす */
  solidSparks(now: number, x: number, y: number, dirX: number, dirY: number, budget: number): void {
    const k = 1.3;
    this.sparks(now, x, y, SOLID_RGB[0] * k, SOLID_RGB[1] * k, SOLID_RGB[2] * k, 2, 3, budget, Math.atan2(dirY, dirX));
  }

  /**
   * 壊れないブロックがフィナーレの衝撃波で砕ける: 光の点と、aim（衝撃波の中心から外への向き）へ散る火花。
   * 色は鋼の色
   */
  solidShatter(now: number, x: number, y: number, aim: number, budget: number): void {
    const r = SOLID_RGB[0];
    const g = SOLID_RGB[1];
    const b = SOLID_RGB[2];
    this.emit(now, x, y, 0, 0, 0.16, 0.35, 0.8, r * 1.4, g * 1.4, b * 1.4, ParticleShape.Dot, 0, 0);
    this.sparks(now, x, y, r * 1.6, g * 1.6, b * 1.6, 5, 6, budget, aim);
  }

  /** パドルで打った火花。上向きに散らし、色は背景の色相の反対側 */
  paddleSparks(now: number, x: number, y: number, hue: number, budget: number): void {
    const c = neonRgb(hue / TAU + 0.5, this.c);
    this.sparks(now, x, y, c[0], c[1], c[2], 4, 3, budget, Math.PI / 2);
  }

  /** 上限を超えて出てこられなかったボールが、光の筋になってスコアへ吸い込まれる */
  overflowStreak(now: number, x: number, y: number): void {
    const a = Math.random() * Math.PI * 2;
    this.scoreStreak(now, x, y, Math.cos(a) * 3, Math.sin(a) * 3, 0.7 + Math.random() * 0.3, 0.22, 0.12);
  }

  /** フィナーレの炸裂: 広がる輪と白い火花 */
  finaleBurst(now: number, x: number, y: number, budget: number): void {
    this.ring(now, x, y, 0.4, 9, 0.9, 1.2, 1.25, 1.4);
    this.sparks(now, x, y, 1.2, 1.2, 1.3, 40, 9, budget, Number.NaN);
  }

  /** エンドレスの全消し: フィナーレの炸裂より小さい輪と火花 */
  allClearBurst(now: number, x: number, y: number, budget: number): void {
    this.ring(now, x, y, 0.3, 6, 0.7, 1.0, 1.15, 1.35);
    this.sparks(now, x, y, 1.0, 1.1, 1.25, 24, 7, budget, Number.NaN);
  }

  /**
   * フィナーレで衝撃波が通過したボール: 光って、衝撃波の中心 (cx, cy) から外へ押し出されてから、flight 秒でスコアへ届く。
   */
  finaleStreak(now: number, x: number, y: number, cx: number, cy: number, flight: number): void {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const push = 4 + Math.random() * 3;
    this.emit(now, x, y, 0, 0, 0.18, 0.28, 0.5, 1.3, 1.25, 1.1, ParticleShape.Dot, 0, 0);
    this.scoreStreak(now, x, y, (dx / len) * push, (dy / len) * push, flight, 0.22, 0.12);
  }

  /**
   * ゲームオーバーで、ボールが暗い紫の光になって燃え尽きる。
   * 負けの場面なので、祝福に見える明るさや広がりは出さない。スローモーション中でも消えきるよう、寿命は短く取る。
   */
  burnOut(now: number, x: number, y: number): void {
    this.emit(now, x, y, 0, 0.4, 0.12, 0.22, 0.02, 0.45, 0.3, 0.75, ParticleShape.Dot, 0, 0);
    this.emit(now, x, y, (Math.random() - 0.5) * 0.8, 1.2 + Math.random(), 0.14, 0.05, 0, 0.6, 0.4, 0.9, ParticleShape.Spark, 0, 2);
  }

  /** ペナルティで落ちてきたブロックの着地で、高さ y に沿って横一列に火花を散らす */
  slamDust(now: number, y: number): void {
    for (let i = 0; i < 12; i++) {
      const x = (i + 0.5) * (FIELD_W / 12);
      this.sparks(now, x, y, 1.0, 0.55, 0.3, 2, 4, 1, -Math.PI / 2);
    }
  }

  /** 火花を count × budget 個（最低 1 個）。aim が NaN なら全方向、そうでなければ aim の向きを中心に散らす */
  private sparks(
    now: number,
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    count: number,
    speed: number,
    budget: number,
    aim: number,
  ): void {
    const n = Math.max(1, Math.round(count * budget));
    const aimed = !Number.isNaN(aim);
    for (let i = 0; i < n; i++) {
      const a = aimed ? aim + (Math.random() - 0.5) * 2.2 : Math.random() * Math.PI * 2;
      const s = speed * (0.45 + Math.random() * 0.8);
      const life = 0.3 + Math.random() * 0.35;
      const size0 = 0.06 + Math.random() * 0.05;
      this.emit(now, x, y, Math.cos(a) * s, Math.sin(a) * s, life, size0, 0, r, g, b, ParticleShape.Spark, 7, 3.2);
    }
  }

  private ring(now: number, x: number, y: number, size0: number, size1: number, life: number, r: number, g: number, b: number): void {
    this.emit(now, x, y, 0, 0, life, size0, size1, r, g, b, ParticleShape.Ring, 0, 0);
  }

  /** 得点に変わったものが、光の筋になって HUD のスコアへ吸い込まれる。life の時刻ちょうどにスコアへ届く */
  private scoreStreak(now: number, x: number, y: number, vx: number, vy: number, life: number, size0: number, size1: number): void {
    const p = this.p;
    this.fill(x, y, vx, vy, life, size0, size1, STREAK_RGB[0], STREAK_RGB[1], STREAK_RGB[2], ParticleShape.Homing, 0, 0);
    p.targetX = this.anchorX;
    p.targetY = this.anchorY;
    this.particles.emit(now, p);
  }

  private emit(
    now: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size0: number,
    size1: number,
    r: number,
    g: number,
    b: number,
    shape: ParticleShape,
    gravity: number,
    drag: number,
  ): void {
    this.fill(x, y, vx, vy, life, size0, size1, r, g, b, shape, gravity, drag);
    this.particles.emit(now, this.p);
  }

  private fill(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size0: number,
    size1: number,
    r: number,
    g: number,
    b: number,
    shape: ParticleShape,
    gravity: number,
    drag: number,
  ): void {
    const p = this.p;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.size0 = size0;
    p.size1 = size1;
    p.r = r;
    p.g = g;
    p.b = b;
    p.shape = shape;
    p.gravity = gravity;
    p.drag = drag;
    p.targetX = 0;
    p.targetY = 0;
  }
}
