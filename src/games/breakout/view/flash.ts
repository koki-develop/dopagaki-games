import * as THREE from 'three/webgpu';
import { vec3, vec4 } from 'three/tsl';
import type { ViewUniforms } from './uniforms.ts';

/**
 * 画面全体のフラッシュ。明るさは u.flash で決まり、必ずフラッシュリミッターを通した値を入れる。
 * 飽和した赤は使わず、白に近い青みの光にする。
 */
export class FlashView {
  readonly mesh: THREE.Mesh;
  private readonly u: ViewUniforms;

  constructor(u: ViewUniforms) {
    this.u = u;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.depthTest = false;
    material.colorNode = vec4(vec3(0.85, 0.92, 1.0).mul(u.flash), 1);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
  }

  cover(left: number, right: number, bottom: number, top: number): void {
    const m = 3;
    this.mesh.position.set((left + right) / 2, (bottom + top) / 2, 1);
    this.mesh.scale.set(right - left + m * 2, top - bottom + m * 2, 1);
  }

  /** u.flash を書き終えたあと、描画の前に毎フレーム呼ぶ。強さが 0 なら何も足さないので描かない */
  update(): void {
    this.mesh.visible = this.u.flash.value !== 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
