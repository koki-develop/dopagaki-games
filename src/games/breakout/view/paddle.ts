import { abs, exp, float, Fn, positionLocal, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { neon, sdRoundBox } from '../../../engine/tsl.ts';
import { LOOK } from './look.ts';
import type { ViewUniforms } from './uniforms.ts';

const PAD = 0.35;

/**
 * パドル。角の丸いネオンの板。打った瞬間に squash し、白く光る。
 * 世界が止まっていても指に追従するので、位置は実時間で動かす。
 */
export class PaddleView {
  readonly mesh: THREE.Mesh;
  readonly x = uniform(4.5);
  readonly y = uniform(1.8);
  readonly width = uniform(2);
  readonly height = uniform(0.26);
  /** 横と縦の拡大率（squash & stretch） */
  readonly squash = uniform(new THREE.Vector2(1, 1));
  /** 打った瞬間の光 0〜1 */
  readonly flash = uniform(0);

  constructor(u: ViewUniforms) {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.depthTest = false;

    const half = vec2(this.width, this.height).mul(this.squash).mul(0.5);
    const quadHalf = half.add(PAD);
    material.positionNode = vec3(positionLocal.xy.mul(quadHalf.mul(2)).add(vec2(this.x, this.y)), 0);

    material.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(quadHalf.mul(2));
      const d = sdRoundBox(p, half, half.y);
      const body = smoothstep(0.012, -0.012, d);
      const tint = neon(u.hue.div(6.28318).add(0.5));
      const edge = exp(abs(d).mul(-50)).mul(LOOK.paddle.edge).add(exp(abs(d).mul(-9)).mul(LOOK.paddle.edgeGlow));
      // 中央の細い光の帯。py は負にもなるので、2 乗は掛け算で書く
      const py = p.y.div(half.y.max(1e-3));
      const center = exp(py.mul(py).mul(-6)).mul(body);
      const col = tint.mul(edge).add(vec3(0.9, 1.0, 1.1).mul(center.mul(LOOK.paddle.centerLine))).add(tint.mul(body.mul(LOOK.paddle.fill)));
      const flashCol = vec3(1, 1, 1.1).mul(LOOK.paddle.hitFlash).mul(this.flash).mul(body.add(edge.mul(0.5)));
      return vec4(col.add(flashCol).mul(float(1).add(u.intensity.mul(0.3))), 1);
    })();

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 45;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
