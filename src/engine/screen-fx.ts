import { float, Fn, mix, positionWorld, smoothstep, vec3, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import type { FloatUniform } from './tsl.ts';

/** カメラの映す範囲より、どれだけ広く覆うか（揺れや引きで端が見えないように） */
const COVER_MARGIN = 3;

/** 板を left〜right、bottom〜top より少し広く覆う位置と大きさにする */
function coverRect(mesh: THREE.Mesh, left: number, right: number, bottom: number, top: number, z: number): void {
  mesh.position.set((left + right) / 2, (bottom + top) / 2, z);
  mesh.scale.set(right - left + COVER_MARGIN * 2, top - bottom + COVER_MARGIN * 2, 1);
}

type ScreenFlashOptions = {
  /** 明るさ。必ずフラッシュリミッター（juice/flash.ts）を通した値を入れる */
  level: FloatUniform;
  renderOrder: number;
};

/**
 * 画面全体のフラッシュ。明るさ level の光を加算で重ねる。
 * 飽和した赤は使わず、白に近い青みの光にする（WCAG 2.3.1 の赤い閃光を避ける）。
 */
export class ScreenFlash {
  readonly mesh: THREE.Mesh;
  private readonly level: FloatUniform;

  constructor(opts: ScreenFlashOptions) {
    this.level = opts.level;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.depthTest = false;
    material.colorNode = vec4(vec3(0.85, 0.92, 1.0).mul(opts.level), 1);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder;
  }

  /** カメラの映す範囲（ワールド座標）より少し広く覆う */
  cover(left: number, right: number, bottom: number, top: number): void {
    coverRect(this.mesh, left, right, bottom, top, 1);
  }

  /** level を書き終えたあと、描画の前に毎フレーム呼ぶ。強さが 0 なら何も足さないので描かない */
  update(): void {
    this.mesh.visible = this.level.value !== 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

type FocusVignetteOptions = {
  /** 強さ（0〜1）。1 に近づくほど、暗くない範囲が focus の周りへ縮んでいく */
  strength: FloatUniform;
  /** 絞り込む先の点（ワールド座標） */
  focus: Node<'vec2'>;
  /** 強さ 0 と 1 のときの、暗くない範囲の半径（ワールド単位） */
  outerRadius: number;
  innerRadius: number;
  /** 暗くない範囲の縁から、暗くなりきるまでの幅 */
  band: number;
  /** 暗くなりきったときの不透明度 */
  darkness: number;
  renderOrder: number;
};

/** 画面の縁から、ある点（focus）へ向かって暗く絞り込む。溜めの演出で使う */
export class FocusVignette {
  readonly mesh: THREE.Mesh;
  private readonly strength: FloatUniform;

  constructor(opts: FocusVignetteOptions) {
    this.strength = opts.strength;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.depthWrite = false;
    material.depthTest = false;
    material.colorNode = Fn(() => {
      const d = positionWorld.xy.sub(opts.focus).length();
      const inner = mix(float(opts.outerRadius), float(opts.innerRadius), opts.strength);
      const dark = smoothstep(inner, inner.add(opts.band), d).mul(opts.strength).mul(opts.darkness);
      return vec4(0, 0, 0.01, dark);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder;
  }

  /** カメラの映す範囲（ワールド座標）より少し広く覆う */
  cover(left: number, right: number, bottom: number, top: number): void {
    coverRect(this.mesh, left, right, bottom, top, 0.5);
  }

  /** strength を書き終えたあと、描画の前に毎フレーム呼ぶ。強さが 0 なら不透明度が 0 で下の色を変えないので描かない */
  update(): void {
    this.mesh.visible = this.strength.value !== 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
