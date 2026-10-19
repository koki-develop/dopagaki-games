import { atan, clamp, exp, float, floor, fract, Fn, If, mix, positionWorld, sin, smoothstep, vec3, vec4 } from 'three/tsl';
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

type ImpactLinesOptions = {
  /** 実時間（秒）。世界が止まっている間も進む時計 */
  real: Node<'float'>;
  /** 中心 x, y（ワールド座標）、始めた実時間、強さ（0〜1） */
  impact: Node<'vec4'>;
  /** 線の内側の端が、寄り始める距離と寄りきる距離（ワールド単位） */
  reachFrom: number;
  reachTo: number;
  /** 線の明るさ */
  brightness: number;
  renderOrder: number;
};

/** 集中線が見えている長さ（実時間の秒） */
const IMPACT_LIFE = 0.42;
/** 線の本数（1 周あたり） */
const IMPACT_COUNT = 72;
/** 線ごとに届く深さの散らばりと、線の内側の端のぼかしの幅（寄る距離に対する割合） */
const IMPACT_JITTER = 2.2 / 8.6;
const IMPACT_SOFT = 1.4 / 8.6;

/**
 * ヒットストップの集中線。中心へ向かって、画面の外側から細い光の筋が寄ってきて消える。
 * 線の内側の端は時間とともに中心へ寄り、太さと長さは線ごとに乱数で変える。時刻は実時間なので、世界が止まっている間も動く。
 * 加算で重ねる。
 */
export class ImpactLines {
  readonly mesh: THREE.Mesh;

  constructor(opts: ImpactLinesOptions) {
    const { real, impact } = opts;
    const span = opts.reachFrom - opts.reachTo;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending });
    material.depthWrite = false;
    material.depthTest = false;
    material.colorNode = Fn(() => {
      const out = vec4(0, 0, 0, 0).toVar();
      const age = real.sub(impact.z);
      If(age.greaterThanEqual(0).and(age.lessThan(IMPACT_LIFE)), () => {
        const k = age.div(IMPACT_LIFE);
        const d = positionWorld.xy.sub(impact.xy);
        const r = d.length();
        const lane = atan(d.y, d.x).div(Math.PI * 2).add(0.5).mul(IMPACT_COUNT);
        const id = floor(lane);
        // 線ごとの乱数（0〜1）
        const h = fract(sin(id.mul(12.9898)).mul(43758.5453));
        const h2 = fract(sin(id.mul(78.233)).mul(12345.678));
        const across = fract(lane).sub(0.5).abs();
        const width = float(0.06).add(h.mul(0.18));
        const line = float(1).sub(smoothstep(width.mul(0.3), width, across));
        // 内側の端が外から寄ってくる。線ごとに届く深さを変える
        const ease = float(1).sub(exp(k.mul(-5)));
        const inner = float(opts.reachFrom).sub(ease.mul(span)).add(h2.mul(span * IMPACT_JITTER));
        const body = smoothstep(inner, inner.add(span * IMPACT_SOFT), r);
        const fade = float(1).sub(k).mul(float(1).sub(k));
        const on = smoothstep(0.35, 0.55, h);
        const a = clamp(line.mul(body).mul(fade).mul(on).mul(impact.w).mul(opts.brightness), 0, 1);
        out.assign(vec4(vec3(1, 0.97, 0.9).mul(a), a));
      });
      return out;
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder;
  }

  /** カメラの映す範囲（ワールド座標）を覆う */
  cover(left: number, right: number, bottom: number, top: number): void {
    this.mesh.position.set((left + right) / 2, (bottom + top) / 2, 0);
    this.mesh.scale.set(right - left, top - bottom, 1);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
