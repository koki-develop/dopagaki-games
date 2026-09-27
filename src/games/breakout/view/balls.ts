import * as THREE from 'three/webgpu';
import { exp, float, Fn, max, mix, positionLocal, smoothstep, step, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { BALL_CAP, BALL_RADIUS } from '../config.ts';
import { InstanceBuffer, unitQuad } from '../../../engine/instanced.ts';
import { drawCount } from '../../../engine/ring.ts';
import { neon, sdSegment } from './tsl.ts';
import { LOOK } from './look.ts';
import type { ViewUniforms } from './uniforms.ts';

const R = BALL_RADIUS;

/** ボールの位置の読み取り口。p* は前の固定ステップ、x / y は今の固定ステップの位置 */
export type BallSource = {
  readonly count: number;
  readonly px: ArrayLike<number>;
  readonly py: ArrayLike<number>;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly dx: ArrayLike<number>;
  readonly dy: ArrayLike<number>;
};

/** 四角形の半幅（ボールの半径に対する倍率）。光の広がりは bloom に任せるので小さく保つ */
const HALO = 1.9;

/**
 * ボール。インスタンスごとに (x, y, 向き x, 向き y) と (動いているか) を持つ。
 * 白く光る芯と色の付いた縁で描き、動いているボールだけを速度の方向に少し引き伸ばす。
 * パドルに乗って止まっているボールは真円で描く。加算合成。
 */
export class BallsView {
  readonly mesh: THREE.Mesh;
  private readonly inst = new InstanceBuffer(BALL_CAP + 2, 2);
  /** 動いているボールの引き伸ばしの長さ（芯の線分の半分の長さ） */
  readonly stretch = uniform(R * 0.8);
  /**
   * 1 個あたりの明るさ。数百個のボールの光が加算で重なると画面が白く飛ぶので、数が多いほど下げる。
   * 全体としての明るさは数とともに増えるが、色は残る。
   */
  readonly brightness = uniform(1);

  constructor(u: ViewUniforms) {
    const [a, b] = this.inst.nodes;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.depthTest = false;

    const dirLen = a.zw.length();
    const visible = step(1e-4, dirLen);
    const dir = a.zw.div(max(dirLen, 1e-4));
    const perp = vec2(dir.y.negate(), dir.x);
    const stretch = this.stretch.mul(b.x);
    const halfLen = stretch.add(R * HALO);
    const halfWid = float(R * HALO);
    const lp = positionLocal.xy.mul(2);
    const world = a.xy.add(dir.mul(lp.x.mul(halfLen))).add(perp.mul(lp.y.mul(halfWid)));
    // 溜めの間は、吸い込まれる点へ少し引き寄せる
    const pulled = mix(world, u.focus, u.inhale.mul(0.22));
    material.positionNode = vec3(mix(a.xy, pulled, visible), 0);

    material.colorNode = Fn(() => {
      // 四角形内の位置をワールド単位に戻す（x は進行方向）
      const q = uv().sub(0.5).mul(2);
      const p = vec2(q.x.mul(halfLen), q.y.mul(halfWid));
      const d = sdSegment(p, vec2(stretch.negate(), 0), vec2(stretch, 0));
      const core = smoothstep(R * 0.95, R * 0.55, d);
      const halo = exp(d.div(R).pow(2).mul(-1.6));
      const tint = neon(u.hue.div(6.28318).add(0.5));
      const col = vec3(1, 1.04, 1.1).mul(LOOK.ball.core).mul(core).add(tint.mul(halo).mul(LOOK.ball.halo));
      return vec4(col.mul(float(0.85).add(u.intensity.mul(0.25))).mul(this.brightness), 1);
    })();

    this.mesh = new THREE.Mesh(unitQuad(), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 40;
    this.mesh.count = drawCount(0);
  }

  /**
   * ボールの位置を書き出す。alpha は固定ステップ間の補間係数。
   * attachedX / attachedY が有限なら、発射待ちのボールも 1 個描く。
   */
  update(balls: BallSource, alpha: number, attachedX: number, attachedY: number): void {
    const d = this.inst.data;
    const stride = this.inst.stride;
    const n = balls.count;
    for (let i = 0; i < n; i++) {
      const o = i * stride;
      d[o] = balls.px[i] + (balls.x[i] - balls.px[i]) * alpha;
      d[o + 1] = balls.py[i] + (balls.y[i] - balls.py[i]) * alpha;
      d[o + 2] = balls.dx[i];
      d[o + 3] = balls.dy[i];
      d[o + 4] = 1;
    }
    let total = n;
    if (Number.isFinite(attachedX)) {
      // 止まっているので引き伸ばさない。向きは描画の基準に使うだけ
      const o = total * stride;
      d[o] = attachedX;
      d[o + 1] = attachedY;
      d[o + 2] = 0;
      d[o + 3] = 1;
      d[o + 4] = 0;
      total++;
    }
    const count = drawCount(total);
    for (let k = total; k < count; k++) d.fill(0, k * stride, (k + 1) * stride);
    this.mesh.count = count;
    this.inst.markDirty(0, count);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
