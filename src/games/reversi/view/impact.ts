import { atan, clamp, exp, float, floor, fract, Fn, If, positionWorld, sin, smoothstep, vec3, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { LOOK } from './look.ts';
import type { ViewUniforms } from './uniforms.ts';

/** 集中線が見えている長さ（実時間の秒） */
const LIFE = 0.42;
/** 線の本数（1 周あたり） */
const COUNT = 72;
/** 線の内側の端が、画面の外から寄ってくる距離（ワールド単位。1 マスは 1） */
const REACH_FROM = 11;
const REACH_TO = 2.4;

/**
 * ヒットストップの集中線。打ったマスへ向かって、画面の外側から細い光の筋が寄ってきて消える。
 * 線の内側の端は時間とともに中心へ寄り、太さと長さは線ごとに乱数で変える。時刻は実時間なので、世界が止まっている間も動く。
 * 盤と石と粒の上、フラッシュの下に加算で重ねる。
 */
export class ImpactView {
  readonly mesh: THREE.Mesh;

  constructor(u: ViewUniforms) {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending });
    material.depthWrite = false;
    material.depthTest = false;
    material.colorNode = Fn(() => {
      const out = vec4(0, 0, 0, 0).toVar();
      const age = u.real.sub(u.impact.z);
      If(age.greaterThanEqual(0).and(age.lessThan(LIFE)), () => {
        const k = age.div(LIFE);
        const d = positionWorld.xy.sub(u.impact.xy);
        const r = d.length();
        const lane = atan(d.y, d.x).div(Math.PI * 2).add(0.5).mul(COUNT);
        const id = floor(lane);
        // 線ごとの乱数（0〜1）
        const h = fract(sin(id.mul(12.9898)).mul(43758.5453));
        const h2 = fract(sin(id.mul(78.233)).mul(12345.678));
        const across = fract(lane).sub(0.5).abs();
        const width = float(0.06).add(h.mul(0.18));
        const line = float(1).sub(smoothstep(width.mul(0.3), width, across));
        // 内側の端が外から寄ってくる。線ごとに届く深さを変える
        const ease = float(1).sub(exp(k.mul(-5)));
        const inner = float(REACH_FROM).sub(ease.mul(REACH_FROM - REACH_TO)).add(h2.mul(2.2));
        const body = smoothstep(inner, inner.add(1.4), r);
        const fade = float(1).sub(k).mul(float(1).sub(k));
        const on = smoothstep(0.35, 0.55, h);
        const a = clamp(line.mul(body).mul(fade).mul(on).mul(u.impact.w).mul(LOOK.impactLines), 0, 1);
        out.assign(vec4(vec3(1, 0.97, 0.9).mul(a), a));
      });
      return out;
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 85;
  }

  /** カメラの映す範囲を覆う */
  cover(left: number, right: number, bottom: number, top: number): void {
    this.mesh.position.set((left + right) / 2, (bottom + top) / 2, 0);
    this.mesh.scale.set(right - left, top - bottom, 1);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
