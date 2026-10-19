import { atan, exp, float, Fn, fract, If, Loop, max, mix, positionWorld, sin, smoothstep, vec2, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { neon } from '../../../engine/tsl.ts';
import { SHOCKWAVE } from '../config.ts';
import { TABLE_H, TABLE_W } from '../geometry.ts';
import { LOOK } from './look.ts';
import { DEALER_LINE_HUE, FELT_RGB, PLAYER_LINE_HUE } from './palette.ts';
import type { ViewUniforms } from './uniforms.ts';

const CX = TABLE_W / 2;
const CY = TABLE_H / 2;

/**
 * 背景。深い緑のフェルトの地（細かい毛羽立ちの揺らぎと、卓の中央を照らす明かり、端の暗がり）の上に、
 * 卓の中心から広がる同心円と放射状の光を描く。衝撃波（SHOCKWAVE.slots 件まで重なる）もここで描く。
 * 同心円と光は実時間で流し、ヒットストップの間も止めない（世界だけが止まって見えるように）。
 * - 同心円は演出の強さとフィーバーのビートで浮かび、外へゆっくり流れる
 * - 放射状の光はブラックジャックと大きな勝ちで広がり（rays）、ゆっくり回る
 * - 光の色は金に寄せ、負けの間は全体が暗くなる（dread）
 */
export class BackgroundView {
  readonly mesh: THREE.Mesh;

  constructor(u: ViewUniforms) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.depthWrite = false;
    material.depthTest = false;
    material.colorNode = Fn(() => {
      const t = u.time;
      const r = u.real;
      const p = positionWorld.xy;
      const c = p.sub(vec2(CX, CY));
      const dist = c.length();
      const side = smoothstep(2, 11, p.y);
      const hue = mix(float(PLAYER_LINE_HUE), float(DEALER_LINE_HUE), side).add(u.hue).add(u.rainbowTurns.mul(2 / 3));
      const tint = neon(hue);

      // 下地: フェルト。中央を明かりで照らし、端へ暗く落とす。細かい毛羽立ちの揺らぎを乗せる
      const fiber = fract(sin(p.x.mul(127.1).add(p.y.mul(311.7))).mul(43758.5453)).mul(0.08).add(0.96);
      const lamp = exp(dist.mul(dist).mul(-0.012)).mul(1.6).add(0.25);
      const col = vec3(...FELT_RGB).mul(lamp).mul(fiber).toVar();
      col.addAssign(tint.mul(exp(dist.mul(-0.22)).mul(LOOK.background.base).mul(float(1).add(u.glow.mul(3)).add(u.fever.mul(LOOK.background.fever)))));

      // 同心円: 細い輪が外へ流れ、ビートで明るくなる
      const ringPhase = sin(dist.mul(2.4).sub(r.mul(1.4)));
      const rings = ringPhase
        .mul(0.5)
        .add(0.5)
        .max(0)
        .pow(48)
        .mul(exp(dist.mul(-0.1)))
        .mul(LOOK.background.rings)
        .mul(u.beat.mul(0.9).add(u.intensity.mul(0.7)));
      col.addAssign(tint.mul(rings));

      // 放射状の光。光が見えている間だけ計算する
      If(u.rays.greaterThan(0.001), () => {
        const ang = atan(c.y, c.x);
        const beams = sin(ang.mul(36).add(r.mul(0.7))).mul(0.5).add(0.5).max(0).pow(28);
        const beams2 = sin(ang.mul(22).sub(r.mul(0.45))).mul(0.5).add(0.5).max(0).pow(40);
        const reach = smoothstep(1.5, 5, dist).mul(exp(dist.mul(-0.07)));
        col.addAssign(neon(hue.add(ang.mul(0.16))).mul(beams.add(beams2.mul(0.7)).mul(reach).mul(u.rays).mul(LOOK.background.rays)));
      });

      // 衝撃波。描く長さを過ぎたものと、まだ始まっていないもの（開始時刻が PRESENT_LONG_AGO の枠を含む）は計算しない
      const shockCol = mix(tint, vec3(1, 0.95, 0.85), 0.5).mul(LOOK.background.shock);
      Loop(SHOCKWAVE.slots, ({ i }) => {
        const s = u.shockwaves.element(i);
        const age = t.sub(s.z);
        If(age.greaterThanEqual(0).and(age.lessThan(SHOCKWAVE.life)), () => {
          const d = p.sub(s.xy).length().sub(age.mul(s.w));
          col.addAssign(shockCol.mul(exp(d.mul(d).mul(-SHOCKWAVE.width)).mul(exp(age.mul(-SHOCKWAVE.decay)))));
        });
      });

      return max(col.mul(float(1).sub(u.dread.mul(0.6))), vec3(0, 0, 0));
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
  }

  /** カメラの映す範囲より少し広く覆う（揺れで端が見えないように） */
  cover(left: number, right: number, bottom: number, top: number): void {
    const m = 3;
    this.mesh.position.set((left + right) / 2, (bottom + top) / 2, -1);
    this.mesh.scale.set(right - left + m * 2, top - bottom + m * 2, 1);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
