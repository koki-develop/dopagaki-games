import * as THREE from 'three/webgpu';
import { float, Fn, mix, positionWorld, smoothstep, vec4 } from 'three/tsl';
import type { ViewUniforms } from './uniforms.ts';

/**
 * 画面の縁から、ある点（u.focus）へ向かって暗く絞り込む。ステージクリアの溜めで使う。
 * 強さ u.vignette が 1 に近づくほど、暗くない範囲が点の周りへ縮んでいく。
 */
export class VignetteView {
  readonly mesh: THREE.Mesh;
  private readonly u: ViewUniforms;

  constructor(u: ViewUniforms) {
    this.u = u;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.depthWrite = false;
    material.depthTest = false;
    material.colorNode = Fn(() => {
      const d = positionWorld.xy.sub(u.focus).length();
      const inner = mix(float(14), float(1.2), u.vignette);
      const dark = smoothstep(inner, inner.add(3.5), d).mul(u.vignette).mul(0.92);
      return vec4(0, 0, 0.01, dark);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 90;
  }

  cover(left: number, right: number, bottom: number, top: number): void {
    const m = 3;
    this.mesh.position.set((left + right) / 2, (bottom + top) / 2, 0.5);
    this.mesh.scale.set(right - left + m * 2, top - bottom + m * 2, 1);
  }

  /** u.vignette を書き終えたあと、描画の前に毎フレーム呼ぶ。強さが 0 なら不透明度が 0 で下の色を変えないので描かない */
  update(): void {
    this.mesh.visible = this.u.vignette.value !== 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
