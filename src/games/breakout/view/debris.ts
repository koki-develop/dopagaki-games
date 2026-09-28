import * as THREE from 'three/webgpu';
import {
  abs,
  clamp,
  cos,
  exp,
  float,
  Fn,
  fract,
  max,
  min,
  mix,
  positionLocal,
  positionWorld,
  select,
  sin,
  smoothstep,
  step,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { FIELD_H, FIELD_W } from '../config.ts';
import type { DebrisSpec } from '../fx/particle-shape.ts';
import { InstanceRing, unitQuad } from '../../../engine/instanced.ts';
import { LOOK } from './look.ts';
import type { ViewUniforms } from './uniforms.ts';

type V2 = Node<'vec2'>;

const GRAVITY = 16;
/** 重心を左右の壁からこれだけ離し、それより寄ったら跳ね返す */
const WALL_MARGIN = 0.08;
/** 輪郭をぼかす幅（u）。ブロックの本体と同じ */
const AA = 0.01;
/** 縁の線の鋭さ（1 / u） */
const EDGE_SHARPNESS = 60;

/** 凸多角形（反時計回り）までの符号付き距離（内側が負）。辺の長さが 0 のところは数えない */
function sdConvexQuad(p: V2, v0: V2, v1: V2, v2: V2, v3: V2) {
  const side = (a: V2, b: V2) => {
    const e = b.sub(a);
    const len = e.length();
    const dist = p.sub(a).dot(vec2(e.y, e.x.negate())).div(max(len, 1e-6));
    return select(len.greaterThan(1e-5), dist, float(-1e3));
  };
  return max(max(side(v0, v1), side(v1, v2)), max(side(v2, v3), side(v3, v0)));
}

/**
 * 割れたブロックの小さな破片。細い縁と暗い塗りだけで描き、回りながら落ちて、寿命の間に薄くなって消える。
 * 位置は発生時の条件と時刻から頂点シェーダーで計算する。重心は左右の壁と天井で跳ね返る。
 * 演出の側（`DebrisFx`）が、寿命の間に出す数を実効容量以内に抑えるので、生きている破片が上書きされることはない。
 * すべて 0 のインスタンスは寿命 0 で描かれない。
 */
export class DebrisView {
  readonly mesh: THREE.Mesh;
  private readonly ring: InstanceRing;

  constructor(u: ViewUniforms, capacity: number) {
    // a: 重心 xy・速度 zw、b: 発生時刻・回る速さ・寿命・未使用、c: 縁の色 rgb・未使用、d: 頂点 0 と 1、e: 頂点 2 と 3（重心基準）
    this.ring = new InstanceRing(capacity, 5);
    const [a, b, c, d, e] = this.ring.nodes;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.depthWrite = false;
    material.depthTest = false;

    const age = u.time.sub(b.x);
    const life = b.z;
    const alive = step(0, age).mul(step(age, life)).mul(step(1e-3, life));

    // 重心: 等加速度運動を、左右の壁と天井で折り返す。天井より上で割れたものは、その高さで折り返す（天井の裏に隠れている）
    const span = FIELD_W - 2 * WALL_MARGIN;
    const rawX = a.x.add(a.z.mul(age)).sub(WALL_MARGIN);
    const cx = float(WALL_MARGIN + span).sub(abs(fract(rawX.div(2 * span)).mul(2 * span).sub(span)));
    const rawY = a.y.add(a.w.mul(age)).sub(age.mul(age).mul(GRAVITY / 2));
    const ceiling = max(float(FIELD_H), a.y);
    const cy = min(rawY, ceiling.mul(2).sub(rawY));

    // 四角形を、破片の頂点を囲む矩形に合わせる
    const v0 = d.xy;
    const v1 = d.zw;
    const v2 = e.xy;
    const v3 = e.zw;
    const lo = min(min(v0, v1), min(v2, v3)).sub(AA * 2);
    const hi = max(max(v0, v1), max(v2, v3)).add(AA * 2);
    const corner = mix(lo, hi, positionLocal.xy.add(0.5));
    const local = corner.toVarying('vDebrisLocal');
    const lp = corner.mul(alive);
    const rot = b.y.mul(age);
    const cr = cos(rot);
    const sr = sin(rot);
    const rotated = vec2(lp.x.mul(cr).sub(lp.y.mul(sr)), lp.x.mul(sr).add(lp.y.mul(cr)));
    material.positionNode = vec3(vec2(cx, cy).add(rotated), 0);

    const fade = float(1).sub(clamp(age.div(max(life, 1e-3)), 0, 1)).toVarying('vDebrisFade');

    material.colorNode = Fn(() => {
      const dist = sdConvexQuad(local, v0, v1, v2, v3);
      const inside = smoothstep(AA, -AA, dist);
      const edge = exp(abs(dist).mul(-EDGE_SHARPNESS)).mul(LOOK.debris.edge);
      const col = vec3(c.x, c.y, c.z).mul(edge.add(inside.mul(LOOK.debris.fill)));
      // ブロックと同じく、天井より上は天井の裏に隠す
      const belowCeiling = step(positionWorld.y, FIELD_H);
      return vec4(col.mul(belowCeiling), inside.mul(fade).mul(belowCeiling));
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
  emit(now: number, p: DebrisSpec): void {
    const data = this.ring.data;
    const o = this.ring.claim();
    data[o] = p.x;
    data[o + 1] = p.y;
    data[o + 2] = p.vx;
    data[o + 3] = p.vy;
    data[o + 4] = now;
    data[o + 5] = p.spin;
    data[o + 6] = p.life;
    data[o + 7] = 0;
    data[o + 8] = p.r;
    data[o + 9] = p.g;
    data[o + 10] = p.b;
    data[o + 11] = 0;
    for (let j = 0; j < 8; j++) data[o + 12 + j] = p.verts[j];
  }

  /** このフレームに書き込んだ範囲だけを GPU へ送り、描画数を合わせる */
  flush(): void {
    this.ring.flush();
    this.mesh.count = this.ring.drawCount;
  }

  /** すべて消す。データを 0（寿命 0）にして、次の描画で全体を送る */
  clear(): void {
    this.ring.clear();
    this.mesh.count = this.ring.drawCount;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
