import { atan, exp, float, Fn, If, Loop, max, mix, positionWorld, sin, smoothstep, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { neon } from '../../../engine/tsl.ts';
import { SHOCKWAVE } from '../config.ts';
import { BOARD_SIZE } from '../rules/position.ts';
import { LOOK } from './look.ts';
import { CPU_LINE_HUE, HUMAN_LINE_HUE } from './palette.ts';
import type { ViewUniforms } from './uniforms.ts';

const HALF = BOARD_SIZE / 2;

/**
 * 背景。暗いグラデーションの上に、盤の中心から広がる同心円と放射状の光を描く。衝撃波（SHOCKWAVE.slots 件まで重なる）もここで描く。
 * 同心円と光は実時間で流し、ヒットストップの間も止めない（世界だけが止まって見えるように）。
 * - 同心円はフィーバーの間だけビートで脈打ち、外へゆっくり流れる
 * - 放射状の光は大きな手で広がり（rays）、ゆっくり回る
 * - 色は手番の色（turnTint）に寄せ、CPU の重い手の間は暗くなる（dread）
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
      const c = p.sub(HALF);
      const dist = c.length();
      const hue = mix(float(CPU_LINE_HUE), float(HUMAN_LINE_HUE), u.turnTint).add(u.hue).add(u.rainbowTurns.mul(2 / 3));
      const tint = neon(hue);

      // 下地: 上がわずかに明るい暗い紫
      const yN = smoothstep(-6, 14, p.y);
      const col = mix(vec3(0.008, 0.005, 0.02), vec3(0.02, 0.012, 0.05), yN).toVar();
      col.addAssign(tint.mul(exp(dist.mul(-0.22)).mul(LOOK.background.base).mul(float(1).add(u.glow.mul(3)).add(u.fever.mul(LOOK.background.fever)))));

      // 同心円: 細い輪が外へ流れ、ビートで明るくなる
      const ringPhase = sin(dist.mul(2.4).sub(r.mul(1.4)));
      const rings = ringPhase.mul(0.5).add(0.5).pow(48).mul(exp(dist.mul(-0.1))).mul(LOOK.background.rings).mul(float(0.3).add(u.beat.mul(0.9)).add(u.intensity.mul(0.7)));
      col.addAssign(tint.mul(rings));

      // 放射状の光（大きな手で広がる）。細い光の筋を色相をずらしながら回す。光が見えている間だけ計算する
      If(u.rays.greaterThan(0.001), () => {
        const ang = atan(c.y, c.x);
        const beams = sin(ang.mul(36).add(r.mul(0.7))).mul(0.5).add(0.5).pow(28);
        const beams2 = sin(ang.mul(22).sub(r.mul(0.45))).mul(0.5).add(0.5).pow(40);
        const reach = smoothstep(1.5, 5, dist).mul(exp(dist.mul(-0.07)));
        const beamCol = neon(hue.add(ang.mul(0.16)));
        col.addAssign(beamCol.mul(beams.add(beams2.mul(0.7)).mul(reach).mul(u.rays).mul(LOOK.background.rays)));
      });

      // 衝撃波（終局の決着と大きな手）。描く長さを過ぎたものと、まだ始まっていないもの（開始時刻が LONG_AGO の枠を含む）は計算しない
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
