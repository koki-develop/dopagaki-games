import * as THREE from 'three/webgpu';
import { abs, exp, float, floor, Fn, max, mix, positionLocal, select, smoothstep, step, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { BALL_CAP, BALL_RADIUS, FIELD_W } from '../config.ts';
import { InstanceBuffer, InstanceRing, unitQuad } from '../../../engine/instanced.ts';
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

/** ボールの見た目の uniform のうち、生きているボールと奈落に落ちたボールに共通のもの */
export function createBallLook() {
  return {
    /** 動いているボールの引き伸ばしの長さ（芯の線分の半分の長さ） */
    stretch: uniform(R * 0.8),
    /**
     * 1 個あたりの明るさ。数百個のボールの光が加算で重なると画面が白く飛ぶので、数が多いほど下げる。
     * 全体としての明るさは数とともに増えるが、色は残る。
     */
    brightness: uniform(1),
  };
}

export type BallLook = ReturnType<typeof createBallLook>;

/**
 * ボールの材質。白く光る芯と色の付いた縁で描き、motion（速度の向きの長さが 0 なら描かない）の方向に、
 * moving（0〜1）の分だけ引き伸ばす。加算合成。
 */
function ballMaterial(u: ViewUniforms, look: BallLook, center: Node<'vec2'>, motion: Node<'vec2'>, moving: Node<'float'>): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
  material.blending = THREE.AdditiveBlending;
  material.depthWrite = false;
  material.depthTest = false;

  const dirLen = motion.length();
  const visible = step(1e-4, dirLen);
  const dir = motion.div(max(dirLen, 1e-4));
  const perp = vec2(dir.y.negate(), dir.x);
  const stretch = look.stretch.mul(moving);
  const halfLen = stretch.add(R * HALO);
  const halfWid = float(R * HALO);
  const lp = positionLocal.xy.mul(2);
  const world = center.add(dir.mul(lp.x.mul(halfLen))).add(perp.mul(lp.y.mul(halfWid)));
  // 溜めの間は、吸い込まれる点へ少し引き寄せる
  const pulled = mix(world, u.focus, u.inhale.mul(0.22));
  material.positionNode = vec3(mix(center, pulled, visible), 0);

  material.colorNode = Fn(() => {
    // 四角形内の位置をワールド単位に戻す（x は進行方向）
    const q = uv().sub(0.5).mul(2);
    const p = vec2(q.x.mul(halfLen), q.y.mul(halfWid));
    const d = sdSegment(p, vec2(stretch.negate(), 0), vec2(stretch, 0));
    const core = smoothstep(R * 0.95, R * 0.55, d);
    const halo = exp(d.div(R).pow(2).mul(-1.6));
    const tint = neon(u.hue.div(6.28318).add(0.5));
    const col = vec3(1, 1.04, 1.1).mul(LOOK.ball.core).mul(core).add(tint.mul(halo).mul(LOOK.ball.halo));
    return vec4(col.mul(float(0.85).add(u.intensity.mul(0.25))).mul(look.brightness), 1);
  })();
  return material;
}

/**
 * ボール。インスタンスごとに (x, y, 向き x, 向き y) と (動いているか) を持つ。
 * 動いているボールだけを速度の方向に少し引き伸ばし、パドルに乗って止まっているボールは真円で描く。
 */
export class BallsView {
  readonly mesh: THREE.Mesh;
  private readonly inst = new InstanceBuffer(BALL_CAP + 2, 2);

  constructor(u: ViewUniforms, look: BallLook) {
    const [a, b] = this.inst.nodes;
    this.mesh = new THREE.Mesh(unitQuad(), ballMaterial(u, look, a.xy, a.zw, b.x));
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

/** 左右の壁で跳ね返るボールの中心が動ける幅 */
const BOUNCE_SPAN = FIELD_W - 2 * R;

/**
 * 奈落に落ちたボール。sim からは取り除かれたボールを、落ちた位置と速度のまま、画面の外まで落とし続けて描く。
 * 位置は落ちた時刻からの経過で頂点シェーダーが求める。壁は画面の下の外まで伸びているので、左右の壁では跳ね返る。
 * 画面の外へ出たものも描き続け（画面の外なので画素は塗らない）、容量を超えたら古いものから上書きする。
 * すべて 0 のインスタンスは速度が 0 で描かれない。
 */
export class FallenBallsView {
  readonly mesh: THREE.Mesh;
  private readonly ring: InstanceRing;

  constructor(u: ViewUniforms, look: BallLook, capacity: number) {
    // a: 時刻 b.x の位置 xy・速度 zw、b: 時刻（u.time と同じ時間軸）
    this.ring = new InstanceRing(capacity, 2);
    const [a, b] = this.ring.nodes;
    const free = a.xy.add(a.zw.mul(u.time.sub(b.x)));
    // 左右の壁での跳ね返りを、x を壁の間へ折り返して表す。速度の x は、折り返した回数が奇数のとき向きが変わる
    const period = 2 * BOUNCE_SPAN;
    const t = free.x.sub(R);
    const m = t.sub(floor(t.div(period)).mul(period));
    const x = abs(m.sub(BOUNCE_SPAN)).negate().add(BOUNCE_SPAN + R);
    const vx = select(m.lessThan(BOUNCE_SPAN), a.z, a.z.negate());
    this.mesh = new THREE.Mesh(unitQuad(), ballMaterial(u, look, vec2(x, free.y), vec2(vx, a.w), float(1)));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 40;
    this.mesh.count = this.ring.drawCount;
  }

  /** 1 個加える。時刻 at（u.time と同じ時間軸）に位置 (x, y) にあり、速度 (vx, vy) で進むボール */
  emit(at: number, x: number, y: number, vx: number, vy: number): void {
    const d = this.ring.data;
    const o = this.ring.claim();
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = vx;
    d[o + 3] = vy;
    d[o + 4] = at;
  }

  /** このフレームに書き込んだ範囲だけを GPU へ送り、描画数を合わせる */
  flush(): void {
    this.ring.flush();
    this.mesh.count = this.ring.drawCount;
  }

  /** すべて消す。データを 0（速度 0）にして、次の描画で全体を送る */
  clear(): void {
    this.ring.clear();
    this.mesh.count = this.ring.drawCount;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
