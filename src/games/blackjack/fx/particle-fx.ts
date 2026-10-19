import { neonRgb } from '../../../engine/neon.ts';
import { createParticleSpec, ParticleShape } from '../../../engine/particle-spec.ts';
import type { ParticleSink, ParticleSpec } from '../../../engine/particle-spec.ts';
import { CHIP_DUST_RGB, GOLD_RGB, SMOKE_RGB } from '../view/palette.ts';

const TAU = Math.PI * 2;

/**
 * 演出の粒を出す。発生の条件を書き込むオブジェクトは 1 つを使い回し、粒を出すたびにオブジェクトを作らない。
 * 時刻 now はすべて present の時間軸。budget は品質による粒の数の倍率（0〜1）。
 *
 * 勝ち（ブラックジャック、払い戻し、ディーラーのバースト）の粒は外へ弾ける明るい火花、
 * 負け（バースト、取られたチップ）の粒は下へ落ちる暗い煙にする（負けている場面で祝福に見えないように）。
 */
export class ParticleFx {
  private readonly sink: ParticleSink;
  private readonly p: ParticleSpec = createParticleSpec();
  private readonly c: [number, number, number] = [0, 0, 0];

  constructor(sink: ParticleSink) {
    this.sink = sink;
  }

  /** カードが卓に着いた: 小さな土煙。chosen（選んで引いた 1 枚）は少し多く */
  land(now: number, x: number, y: number, chosen: boolean, budget: number): void {
    const n = Math.ceil((chosen ? 10 : 5) * budget);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = 0.8 + Math.random() * 1.4;
      this.dot(now, x + Math.cos(a) * 0.6, y + Math.sin(a) * 0.8, Math.cos(a) * s, Math.sin(a) * s, 0.35 + Math.random() * 0.2, 0.18, 0.4, 0.16, 0.2, 0.24, 0);
    }
  }

  /** 手が勝った: 金の火花。tier（0〜4）が高いほど多く速い */
  win(now: number, x: number, y: number, tier: number, budget: number): void {
    const n = Math.ceil((12 + tier * 14) * budget);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = 3 + Math.random() * (4 + tier * 2.5);
      this.spark(now, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.3 + Math.random() * 0.35, 0.09, GOLD_RGB[0] * 1.5, GOLD_RGB[1] * 1.5, GOLD_RGB[2] * 1.5);
    }
    for (let k = 0; k <= Math.min(2, tier); k++) this.ring(now + k * 0.07, x, y, GOLD_RGB[0], GOLD_RGB[1], GOLD_RGB[2], 0.3, 2.2 + k * 1.6 + tier * 0.4, 0.45);
  }

  /** ブラックジャック: 色相を回した火花の嵐と、何重もの輪 */
  blackjack(now: number, x: number, y: number, budget: number): void {
    const n = Math.ceil(90 * budget);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random() * 0.15;
      const s = 6 + Math.random() * 10;
      const c = neonRgb(i / n, this.c);
      this.spark(now, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.45 + Math.random() * 0.4, 0.12, c[0] * 1.6, c[1] * 1.6, c[2] * 1.6, 2);
    }
    for (let k = 0; k < 4; k++) this.ring(now + k * 0.08, x, y, 1, 0.95, 0.85, 0.4, 4 + k * 2.4, 0.6);
  }

  /** 21 になった: シアンの小さな輪と火花 */
  twentyOne(now: number, x: number, y: number, budget: number): void {
    const c = neonRgb(0.5, this.c);
    const n = Math.ceil(18 * budget);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = 2.5 + Math.random() * 4;
      this.spark(now, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.3 + Math.random() * 0.25, 0.08, c[0] * 1.3, c[1] * 1.3, c[2] * 1.3);
    }
    this.ring(now, x, y, c[0], c[1], c[2], 0.3, 2.6, 0.4);
  }

  /** ディーラーがバーストした（プレイヤーには得）: ディーラーの手から明るい火花が弾ける */
  dealerBust(now: number, x: number, y: number, budget: number): void {
    const n = Math.ceil(40 * budget);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = 4 + Math.random() * 7;
      this.spark(now, x + (Math.random() - 0.5) * 2, y, Math.cos(a) * s, Math.sin(a) * s, 0.4 + Math.random() * 0.3, 0.1, 1.4, 1.3, 1.1);
    }
    this.ring(now, x, y, 1, 0.95, 0.85, 0.4, 4.5, 0.5);
  }

  /** バーストした: 暗い破片が下へ落ちる */
  bust(now: number, x: number, y: number, budget: number): void {
    const n = Math.ceil(22 * budget);
    for (let i = 0; i < n; i++) {
      this.dot(
        now,
        x + (Math.random() - 0.5) * 1.6,
        y + (Math.random() - 0.5) * 1.6,
        (Math.random() - 0.5) * 1.2,
        -0.5 - Math.random() * 1.2,
        0.6 + Math.random() * 0.4,
        0.14,
        0.04,
        SMOKE_RGB[0],
        SMOKE_RGB[1],
        SMOKE_RGB[2],
        3,
      );
    }
  }

  /** チップがディーラーに取られた: 下へ流れる暗い煙 */
  taken(now: number, x: number, y: number, budget: number): void {
    const n = Math.ceil(6 * budget);
    for (let i = 0; i < n; i++) this.dot(now, x + (Math.random() - 0.5) * 0.5, y, (Math.random() - 0.5) * 0.5, -0.3 - Math.random() * 0.4, 0.5, 0.2, 0.5, SMOKE_RGB[0], SMOKE_RGB[1], SMOKE_RGB[2], 0);
  }

  /** チップが着いた: 小さなきらめき。payout なら金、そうでなければ控えめな白 */
  chipLand(now: number, x: number, y: number, payout: boolean, budget: number): void {
    const c = payout ? GOLD_RGB : CHIP_DUST_RGB;
    const n = Math.ceil(4 * budget);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = 0.8 + Math.random() * 1.4;
      this.dot(now, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.35 + Math.random() * 0.2, 0.1, 0, c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, 0);
    }
  }

  /** チップを手持ちへ集める: (x, y) から (tx, ty) へ吸い込まれる光の筋 */
  collect(now: number, x: number, y: number, tx: number, ty: number, life: number, payout: boolean): void {
    const c = payout ? GOLD_RGB : CHIP_DUST_RGB;
    const p = this.p;
    const a = Math.random() * TAU;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(a) * 3;
    p.vy = Math.sin(a) * 3 + 2;
    p.life = life;
    p.size0 = 0.16;
    p.size1 = 0.08;
    p.r = c[0] * 1.4;
    p.g = c[1] * 1.4;
    p.b = c[2] * 1.4;
    p.shape = ParticleShape.Homing;
    p.gravity = 0;
    p.drag = 0;
    p.targetX = tx;
    p.targetY = ty;
    this.sink.emit(now, p);
  }

  /** 増やして終えた: 卓のあちこちから花火のように弾ける */
  fireworks(now: number, x: number, y: number, budget: number): void {
    const c = neonRgb(Math.random(), this.c);
    const n = Math.ceil(16 * budget);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = 3 + Math.random() * 6;
      this.spark(now, x, y, Math.cos(a) * s, Math.sin(a) * s + 3, 0.6 + Math.random() * 0.6, 0.1, c[0] * 1.5, c[1] * 1.5, c[2] * 1.5, 6);
    }
  }

  private spark(now: number, x: number, y: number, vx: number, vy: number, life: number, size: number, r: number, g: number, b: number, gravity = 3): void {
    const p = this.p;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.size0 = size;
    p.size1 = 0;
    p.r = r;
    p.g = g;
    p.b = b;
    p.shape = ParticleShape.Spark;
    p.gravity = gravity;
    p.drag = 2.5;
    this.sink.emit(now, p);
  }

  private dot(now: number, x: number, y: number, vx: number, vy: number, life: number, size0: number, size1: number, r: number, g: number, b: number, gravity: number): void {
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
    p.shape = ParticleShape.Dot;
    p.gravity = gravity;
    p.drag = 3;
    this.sink.emit(now, p);
  }

  private ring(now: number, x: number, y: number, r: number, g: number, b: number, size0: number, size1: number, life: number): void {
    const p = this.p;
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.life = life;
    p.size0 = size0;
    p.size1 = size1;
    p.r = r;
    p.g = g;
    p.b = b;
    p.shape = ParticleShape.Ring;
    p.gravity = 0;
    p.drag = 0;
    this.sink.emit(now, p);
  }
}
