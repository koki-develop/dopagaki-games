import { neonRgb } from '../../../engine/neon.ts';
import { createParticleSpec, ParticleShape } from '../../../engine/particle-spec.ts';
import type { ParticleSink, ParticleSpec } from '../../../engine/particle-spec.ts';
import type { Side } from '../types.ts';
import type { Color } from '../rules/position.ts';
import { RIM_HUE, SMOKE_RGB, STABLE_RGB } from '../view/palette.ts';

const TAU = Math.PI * 2;

/**
 * 演出の粒を出す。発生の条件を書き込むオブジェクトは 1 つを使い回し、粒を出すたびにオブジェクトを作らない。
 * 時刻 now はすべて present の時間軸。budget は品質による粒の数の倍率（0〜1）。
 *
 * 人の手の粒は外へ弾ける明るい火花、CPU の手の粒は下へ落ちる暗い煙にする（負けている場面で祝福に見えないように）。
 */
export class ParticleFx {
  private readonly sink: ParticleSink;
  private readonly p: ParticleSpec = createParticleSpec();
  private readonly c: [number, number, number] = [0, 0, 0];

  constructor(sink: ParticleSink) {
    this.sink = sink;
  }

  /** 石が盤に着いた。人の手は火花と輪、CPU の手は重い土煙 */
  impact(now: number, x: number, y: number, color: Color, side: Side, tier: number, budget: number): void {
    const p = this.p;
    if (side === 'human') {
      const c = neonRgb(RIM_HUE[color], this.c);
      this.ring(now, x, y, c[0], c[1], c[2], 0.3, 1.4 + tier * 0.5, 0.35 + tier * 0.05);
      const n = Math.ceil((10 + tier * 10) * budget);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const s = 3 + Math.random() * (4 + tier * 2.5);
        this.spark(now, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.25 + Math.random() * 0.3, 0.08 + Math.random() * 0.05, c[0] * 1.4, c[1] * 1.4, c[2] * 1.4);
      }
      return;
    }
    const n = Math.ceil(16 * budget);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = 0.8 + Math.random() * 1.6;
      p.x = x + Math.cos(a) * 0.3;
      p.y = y + Math.sin(a) * 0.3;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = 0.6 + Math.random() * 0.4;
      p.size0 = 0.25 + Math.random() * 0.15;
      p.size1 = 0.6;
      p.r = SMOKE_RGB[0];
      p.g = SMOKE_RGB[1];
      p.b = SMOKE_RGB[2];
      p.shape = ParticleShape.Dot;
      p.gravity = 0;
      p.drag = 3;
      this.sink.emit(now, p);
    }
  }

  /** 石が返りきった。新しい色の縁の色で火花を散らす（人の手）。CPU の手は、下へ落ちる暗い粒 */
  flipLanded(now: number, x: number, y: number, color: Color, side: Side, order: number, budget: number): void {
    const c = neonRgb(RIM_HUE[color], this.c);
    if (side === 'human') {
      const n = Math.ceil((5 + Math.min(order, 10)) * budget);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const s = 2 + Math.random() * 3.5;
        this.spark(now, x, y, Math.cos(a) * s, Math.sin(a) * s + 1, 0.2 + Math.random() * 0.25, 0.06 + Math.random() * 0.04, c[0] * 1.3, c[1] * 1.3, c[2] * 1.3);
      }
      this.ring(now, x, y, c[0], c[1], c[2], 0.2, 0.9, 0.25);
      return;
    }
    const p = this.p;
    const n = Math.ceil(6 * budget);
    for (let i = 0; i < n; i++) {
      p.x = x + (Math.random() - 0.5) * 0.6;
      p.y = y + (Math.random() - 0.5) * 0.6;
      p.vx = (Math.random() - 0.5) * 0.6;
      p.vy = -0.4 - Math.random() * 0.6;
      p.life = 0.5 + Math.random() * 0.3;
      p.size0 = 0.1;
      p.size1 = 0.04;
      p.r = c[0] * 0.35;
      p.g = c[1] * 0.25;
      p.b = c[2] * 0.4;
      p.shape = ParticleShape.Dot;
      p.gravity = 2;
      p.drag = 1;
      this.sink.emit(now, p);
    }
  }

  /** 大きな手の返り始め: 打ったマスから放射状に伸びる光の筋 */
  burst(now: number, x: number, y: number, color: Color, tier: number, budget: number): void {
    const c = neonRgb(RIM_HUE[color], this.c);
    const n = Math.ceil((24 + tier * 30) * budget);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random() * 0.1;
      const s = 7 + Math.random() * (6 + tier * 3);
      this.spark(now, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.35 + Math.random() * 0.35, 0.12, c[0] * 1.6, c[1] * 1.6, c[2] * 1.6);
    }
    for (let k = 0; k < tier; k++) this.ring(now + k * 0.07, x, y, 1, 0.95, 0.85, 0.4, 5 + k * 3, 0.55);
  }

  /** 人が角を取った: 金色の光の柱と、何重もの輪 */
  corner(now: number, x: number, y: number, budget: number): void {
    const n = Math.ceil(40 * budget);
    for (let i = 0; i < n; i++) {
      const s = 4 + Math.random() * 9;
      const spread = (Math.random() - 0.5) * 1.2;
      this.spark(now, x + (Math.random() - 0.5) * 0.4, y, spread, s, 0.5 + Math.random() * 0.5, 0.1, STABLE_RGB[0] * 1.5, STABLE_RGB[1] * 1.5, STABLE_RGB[2] * 1.5);
    }
    for (let k = 0; k < 3; k++) this.ring(now + k * 0.09, x, y, STABLE_RGB[0], STABLE_RGB[1], STABLE_RGB[2], 0.3, 3 + k * 1.5, 0.5);
  }

  /** 小さな金色のきらめき（石が確定石になった、人の手の得点が入った） */
  sparkle(now: number, x: number, y: number, budget: number): void {
    const n = Math.ceil(4 * budget);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = 0.6 + Math.random() * 1.2;
      const p = this.p;
      p.x = x + Math.cos(a) * 0.3;
      p.y = y + Math.sin(a) * 0.3;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = 0.5 + Math.random() * 0.3;
      p.size0 = 0.12;
      p.size1 = 0;
      p.r = STABLE_RGB[0] * 1.2;
      p.g = STABLE_RGB[1] * 1.2;
      p.b = STABLE_RGB[2] * 1.2;
      p.shape = ParticleShape.Dot;
      p.gravity = 0;
      p.drag = 2;
      this.sink.emit(now, p);
    }
  }

  /** 勝った: 勝った側の石から花火のように弾ける */
  fireworks(now: number, x: number, y: number, color: Color, budget: number): void {
    const c = neonRgb(RIM_HUE[color] + (Math.random() - 0.5) * 0.2, this.c);
    const n = Math.ceil(8 * budget);
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
