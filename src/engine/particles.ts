import { clamp, exp, float, Fn, max, mix, positionLocal, select, smoothstep, step, uv, vec2, vec3, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { InstanceRing, unitQuad } from './instanced.ts';
import type { ParticleSink, ParticleSpec } from './particle-spec.ts';

type ParticlesOptions = {
  /** 同時に存在できる数の上限。超えたら古いものから上書きする */
  capacity: number;
  /** 今の時刻。発生時刻（emit の now）と同じ時間軸の秒 */
  time: Node<'float'>;
  /** 発生時の色に掛ける明るさ。数が多いと加算で眩しくなるので、1 より小さくして抑える */
  brightness: number;
  /** 描く順番（Mesh.renderOrder） */
  renderOrder: number;
  /** すべての粒を point へ amount（0〜1）の割合だけ寄せる。溜めの演出で吸い込むのに使う */
  attract?: { point: Node<'vec2'>; amount: Node<'float'> };
};

/**
 * パーティクル。発生時の条件だけを GPU に送り、位置は頂点シェーダーで時刻から計算する。
 * 毎フレームの CPU 更新が要らないので、数千個でも軽い。
 * 容量を超えたら古いものから上書きする（リングバッファ）。時刻は u.time と同じ時間軸なので、世界が止まれば止まる。
 * すべて 0 のインスタンスは大きさ 0 で描かれない。
 */
export class ParticlesView implements ParticleSink {
  readonly mesh: THREE.Mesh;
  private readonly ring: InstanceRing;

  constructor(opts: ParticlesOptions) {
    this.ring = new InstanceRing(opts.capacity, 4);
    const [a, b, c, e] = this.ring.nodes;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.depthTest = false;

    const age = opts.time.sub(b.x);
    const life = max(b.y, 1e-3);
    const k = clamp(age.div(life), 0, 1);
    const alive = step(0, age).mul(step(age, life));
    const shape = c.w;
    const isRing = step(1.5, shape).mul(step(shape, 2.5));
    const isHoming = step(2.5, shape);
    const isSpark = step(shape, 0.5);

    // 抗力つきの等加速度運動
    const drag = e.y;
    const g = e.x;
    const decay = exp(drag.negate().mul(age));
    const travel = select(drag.greaterThan(1e-3), float(1).sub(decay).div(max(drag, 1e-3)), age);
    const ballistic = a.xy.add(a.zw.mul(travel)).sub(vec2(0, g.mul(0.5).mul(age).mul(age)));
    const ballisticVel = a.zw.mul(select(drag.greaterThan(1e-3), decay, float(1))).sub(vec2(0, g.mul(age)));
    // 目標へ吸い込まれる光: 2 次ベジェで、最初は発生時の速度の向きへ膨らみ、終わりに向けて加速する
    const ht = k.mul(k);
    const ctrl = a.xy.add(a.zw.mul(0.35));
    const homing = mix(mix(a.xy, ctrl, ht), mix(ctrl, e.zw, ht), ht);
    // ベジェの接線 × パラメータの進む速さ（d(k²)/dt = 2k / life）
    const homingVel = ctrl.sub(a.xy).mul(float(1).sub(ht)).add(e.zw.sub(ctrl).mul(ht)).mul(2).mul(k.mul(2).div(life));
    const vel = mix(ballisticVel, homingVel, isHoming);
    const moved = mix(ballistic, homing, isHoming);
    const pos = opts.attract ? mix(moved, opts.attract.point, opts.attract.amount) : moved;

    const size = mix(b.z, b.w, k).mul(alive);
    const speed = vel.length();
    const dir = select(speed.greaterThan(1e-4), vel.div(max(speed, 1e-4)), vec2(1, 0));
    const perp = vec2(dir.y.negate(), dir.x);
    const isStreak = max(isSpark, isHoming);
    const stretchLen = size.mul(float(1).add(speed.mul(0.09).mul(isStreak)));
    const lp = positionLocal.xy;
    const oriented = dir.mul(lp.x.mul(stretchLen)).add(perp.mul(lp.y.mul(size.mul(0.45))));
    const square = lp.mul(size);
    material.positionNode = vec3(pos.add(mix(square, oriented, isStreak)), 0);

    const kV = k.toVarying('vParticleK');
    material.colorNode = Fn(() => {
      const q = uv().sub(0.5).mul(2);
      const r = q.length();
      const soft = exp(r.mul(r).mul(-4.5));
      const ringD = r.sub(0.82).div(0.07);
      const ring = exp(ringD.mul(ringD).negate()).mul(1.6);
      const shapeA = mix(soft, ring, isRing);
      // 普通の粒は時間とともに消えていく。吸い込まれる光は届く直前まで明るさを保ち、目標に溶け込むように消える。
      // 補間した kV はわずかに 1 を超えることがあるので、pow の底は 0 で止める（負の底では値が決まらない）
      const fadeOut = float(1).sub(kV).max(0).pow(1.4).mul(mix(float(1), smoothstep(0, 0.15, kV), isRing));
      const fade = mix(fadeOut, float(1).sub(smoothstep(0.85, 1, kV)), isHoming);
      return vec4(vec3(c.x, c.y, c.z).mul(shapeA).mul(fade).mul(opts.brightness), 1);
    })();

    this.mesh = new THREE.Mesh(unitQuad(), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder;
    this.mesh.count = this.ring.drawCount;
  }

  /** 品質設定による予算（0〜1）。同時に存在できる数を容量 × 予算にする */
  setBudget(budget: number): void {
    this.ring.setBudget(budget);
  }

  /** 1 個発生させる。now は発生時刻（シェーダーの u.time と同じ時間軸）。p は書き写すだけなので、呼び出し側で使い回してよい */
  emit(now: number, p: ParticleSpec): void {
    const d = this.ring.data;
    const o = this.ring.claim();
    d[o] = p.x;
    d[o + 1] = p.y;
    d[o + 2] = p.vx;
    d[o + 3] = p.vy;
    d[o + 4] = now;
    d[o + 5] = p.life;
    d[o + 6] = p.size0;
    d[o + 7] = p.size1;
    d[o + 8] = p.r;
    d[o + 9] = p.g;
    d[o + 10] = p.b;
    d[o + 11] = p.shape;
    d[o + 12] = p.gravity;
    d[o + 13] = p.drag;
    d[o + 14] = p.targetX;
    d[o + 15] = p.targetY;
  }

  /** このフレームに書き込んだ範囲だけを GPU へ送り、描画数を合わせる */
  flush(): void {
    this.ring.flush();
    this.mesh.count = this.ring.drawCount;
  }

  /** すべて消す。データを 0（大きさ 0）にして、次の描画で全体を送る */
  clear(): void {
    this.ring.clear();
    this.mesh.count = this.ring.drawCount;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
