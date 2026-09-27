import * as THREE from 'three/webgpu';
import { clamp, cos, exp, float, Fn, min, positionLocal, sin, smoothstep, step, uv, vec2, vec3, vec4 } from 'three/tsl';
import { FIELD_W, PIT_TOP } from '../config.ts';
import { InstanceRing, unitQuad } from '../../../engine/instanced.ts';
import type { DebrisSpec } from '../fx/particle-shape.ts';
import { LOOK } from './look.ts';
import type { ViewUniforms } from './uniforms.ts';

const GRAVITY = 16;

/**
 * 壊れたブロックの破片。回りながら落ちて、奈落の暗がりへ沈むように消える。
 * 位置は発生時の条件と時刻から頂点シェーダーで計算する（奈落の底に着く時刻は CPU で求めて渡す）。
 * 容量を超えたら古いものから上書きする。古いものほど消える直前なので、上書きしても目立たない。
 * すべて 0 のインスタンスは大きさ 0 で描かれない。
 */
export class DebrisView {
  readonly mesh: THREE.Mesh;
  private readonly ring: InstanceRing;

  constructor(u: ViewUniforms, capacity: number) {
    // a: 位置 xy・速度 zw、b: 発生時刻・奈落の底に着く時刻・回転の速さ・回転の初期値、c: 色 rgb・大きさ
    this.ring = new InstanceRing(capacity, 3);
    const [a, b, c] = this.ring.nodes;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.depthTest = false;

    const age = u.time.sub(b.x);
    // 生まれてから、奈落の底（y = 0）に着くまでだけ描く
    const alive = step(0, age).mul(step(age, b.y)).mul(step(0.001, c.w));
    const fx = clamp(a.x.add(a.z.mul(age)), 0.06, FIELD_W - 0.06);
    const fy = a.y.add(a.w.mul(age)).sub(age.mul(age).mul(GRAVITY / 2));
    const rot = b.w.add(b.z.mul(age));
    const cr = cos(rot);
    const sr = sin(rot);
    const lp = positionLocal.xy.mul(c.w).mul(alive);
    const rotated = vec2(lp.x.mul(cr).sub(lp.y.mul(sr)), lp.x.mul(sr).add(lp.y.mul(cr)));
    material.positionNode = vec3(vec2(fx, fy).add(rotated), 0);

    // 奈落の上端から下へ沈むにつれて消える。背景の奈落の暗がりと同じ範囲
    const sinkV = smoothstep(0, PIT_TOP, fy).toVarying('vDebrisSink');
    const flightV = exp(age.mul(-3)).toVarying('vDebrisFlight');
    material.colorNode = Fn(() => {
      const q = uv();
      // 直角三角形の破片。縁を少し明るくする
      const tri = q.x.add(q.y);
      const inside = smoothstep(1.02, 0.96, tri).mul(smoothstep(0, 0.04, min(q.x, q.y)));
      const rim = exp(float(1).sub(tri).abs().mul(-30)).mul(inside);
      const bright = flightV.mul(LOOK.debris.flight).add(LOOK.debris.base);
      const col = vec3(c.x, c.y, c.z).mul(inside.mul(bright).add(rim.mul(bright).mul(1.5)));
      return vec4(col.mul(sinkV), 1);
    })();

    this.mesh = new THREE.Mesh(unitQuad(), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.count = this.ring.drawCount;
  }

  /** 品質設定による予算（0〜1）。同時に存在できる数を容量 × 予算にする */
  setBudget(budget: number): void {
    this.ring.setBudget(budget);
  }

  /** 1 個発生させる。now は発生時刻（シェーダーの u.time と同じ時間軸）。p は書き写すだけなので、呼び出し側で使い回してよい */
  emit(now: number, p: DebrisSpec, rand: () => number): void {
    // 奈落の底（y = 0）に着く時刻
    const end = (p.vy + Math.sqrt(p.vy * p.vy + 2 * GRAVITY * Math.max(0, p.y))) / GRAVITY;
    const d = this.ring.data;
    const o = this.ring.claim();
    d[o] = p.x;
    d[o + 1] = p.y;
    d[o + 2] = p.vx;
    d[o + 3] = p.vy;
    d[o + 4] = now;
    d[o + 5] = end;
    d[o + 6] = (rand() * 2 - 1) * 14;
    d[o + 7] = rand() * Math.PI * 2;
    d[o + 8] = p.r;
    d[o + 9] = p.g;
    d[o + 10] = p.b;
    d[o + 11] = p.size;
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
