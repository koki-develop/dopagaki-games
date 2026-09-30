import {
  abs,
  Break,
  clamp,
  cos,
  exp,
  float,
  Fn,
  If,
  Loop,
  min,
  mix,
  positionLocal,
  positionWorld,
  select,
  sin,
  smoothstep,
  step,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import { InstanceBuffer, unitQuad } from '../../../engine/instanced.ts';
import { drawCount } from '../../../engine/ring.ts';
import { neon, sdRoundBox, sdSegment } from '../../../engine/tsl.ts';
import { BLOCK_H, BLOCK_W, BlockType, CELL_H, COLS, FIELD_H } from '../config.ts';
import { cellCenterX, ROW_CAPACITY } from '../sim/blocks.ts';
import { cellRandomTable } from './cell-random.ts';
import { LOOK } from './look.ts';
import { BLOCK_HUE_BOTTOM, BLOCK_HUE_SPAN, HARD_MIX, HARD_RGB, MEGA_HUE_PER_X, MEGA_HUE_SPEED, SOLID_RGB } from './palette.ts';
import type { ViewUniforms } from './uniforms.ts';

const CAPACITY = ROW_CAPACITY * COLS;
/** セルの添字から決まる乱数。ひびの向きや脈動の位相に使う。行が下がっても変わらない */
const CELL_RANDOM = cellRandomTable(CAPACITY);
/** 揺れや出現の拡大で矩形からはみ出す分の余白 */
const PAD = 0.12;
/** 壊れないブロックの斜めの縞の、1 本あたりの幅（ワールドの u）。縞はワールド座標で引き、並んだブロックの間でつながる */
const SOLID_STRIPE_PITCH = 0.22;

/**
 * ブロックの格子の読み取り口。version は、描画に使う内容（種類・HP・当たった時刻・出現時刻・行の位置）が
 * 変わるたびに増える。
 */
type BlockSource = {
  readonly version: number;
  readonly rowCount: number;
  readonly type: ArrayLike<number>;
  readonly hp: ArrayLike<number>;
  readonly maxHp: ArrayLike<number>;
  readonly hitAt: ArrayLike<number>;
  readonly bornAt: ArrayLike<number>;
  rowBottomY(row: number): number;
  slotOf(row: number): number;
};

/**
 * ブロック。インスタンスごとに (中心 x, 中心 y, 種類, 残り HP の割合) と (当たった時刻, 出現時刻, 乱数, 未使用) を持つ。
 * 演出の強さに応じた揺れと、当たったときの震えは、設定の「画面の揺れ」と「視差効果を減らす」から決まる倍率（u.jolt）で弱める。
 * 種類は色だけでなく形でも区別する:
 * - ボール入り: 中に光るコアが 1 つ
 * - ハード: 内枠の二重線と、並んだ 2 つのコア。当たるたびにひびが入り、光が漏れる
 * - ボール大量: 3 × 2 の脈動するコアと、虹色の縁
 * - 壊れない: コアのない鋼の板に、斜めの縞。行の高さで色を変えず、当たっても揺れず、盤面の揺れにも加わらない
 */
export class BlocksView {
  readonly mesh: THREE.Mesh;
  private readonly inst = new InstanceBuffer(CAPACITY, 2);
  /** 最後に書き出した格子と、そのときの version・時刻のずれ。どれも同じなら書き出しを省く */
  private source: BlockSource | null = null;
  private sourceVersion = 0;
  private sourceTimeOffset = 0;

  constructor(u: ViewUniforms) {
    const [a, b] = this.inst.nodes;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.depthWrite = false;
    material.depthTest = false;

    // 種類ごとに 1 か 0。種類は整数を float で渡しているので、前後 0.5 の幅で見分ける
    const type = a.z;
    const typeIs = (t: number) => step(t - 0.5, type).mul(step(type, t + 0.5));
    const isHard = typeIs(BlockType.Hard);
    const isMega = typeIs(BlockType.Mega);
    const isSolid = typeIs(BlockType.Solid);
    const movable = float(1).sub(isSolid);

    // 頂点: 出現の拡大と、当たったときの震え。震えと揺れは、衝撃に伴う画面上の効果なので u.jolt を掛ける
    const hitAge = u.time.sub(b.x);
    const wob = exp(hitAge.mul(-14)).mul(sin(hitAge.mul(55))).mul(0.16).mul(step(0, hitAge)).mul(movable).mul(u.jolt);
    const bornAge = u.time.sub(b.y);
    const appear = clamp(bornAge.div(0.35), 0, 1);
    // 出現の残り（-1〜0）。負の底の累乗は pow では値が決まらないので、掛け算で書く
    const rest = appear.sub(1);
    const rest2 = rest.mul(rest);
    const appearScale = float(1).add(rest2.mul(rest).mul(1.7)).add(rest2.mul(0.7));
    const jiggle = sin(u.time.mul(47).add(b.z.mul(6.28))).mul(u.intensity).mul(0.025).mul(movable).mul(u.jolt);
    const size = vec2(BLOCK_W + PAD * 2, BLOCK_H + PAD * 2);
    // 種類 0 は使っていないインスタンスなので、大きさ 0 にして描かない
    const scale = vec2(float(1).add(wob), float(1).sub(wob)).mul(appearScale.max(0)).mul(step(0.5, a.z));
    const center = vec2(a.x.add(jiggle), a.y.add(jiggle.mul(0.6)));
    material.positionNode = vec3(positionLocal.xy.mul(size).mul(scale).add(center), 0);

    material.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(size).toVar();
      const half = vec2(BLOCK_W / 2, BLOCK_H / 2);
      const d = sdRoundBox(p, half, BLOCK_H * 0.18);
      const hp = a.w;

      // 行の高さで色相を変える（壊れないブロックは変えない）
      const hueT = a.y.div(FIELD_H).mul(BLOCK_HUE_SPAN).add(BLOCK_HUE_BOTTOM);
      const edgeHue = select(isMega.greaterThan(0.5), hueT.add(p.x.mul(MEGA_HUE_PER_X)).add(u.time.mul(MEGA_HUE_SPEED)), hueT);
      const baseCol = mix(mix(neon(edgeHue), vec3(...HARD_RGB), isHard.mul(HARD_MIX)), vec3(...SOLID_RGB), isSolid);

      const edge = exp(abs(d).mul(-55)).mul(LOOK.block.edge).add(exp(abs(d).mul(-14)).mul(LOOK.block.edgeGlow));
      const body = smoothstep(0.01, -0.01, d);
      const col = baseCol.mul(edge).toVar();
      col.addAssign(baseCol.mul(body).mul(mix(float(LOOK.block.fill), float(LOOK.block.solidFill), isSolid)));

      // 壊れない: 斜めの縞
      const stripePhase = positionWorld.x.add(positionWorld.y).div(SOLID_STRIPE_PITCH).mul(Math.PI);
      const stripe = smoothstep(0.35, 0.65, sin(stripePhase)).mul(isSolid);
      col.addAssign(baseCol.mul(stripe.mul(LOOK.block.solidStripe).mul(body)));

      // ハード: 内枠
      const inner = sdRoundBox(p, half.sub(BLOCK_H * 0.19), BLOCK_H * 0.1);
      col.addAssign(baseCol.mul(exp(abs(inner).mul(-60)).mul(LOOK.block.innerFrame)).mul(isHard));

      // ハード: ひび。HP が減るほど本数が増え、ひびから光が漏れる。
      // ひびのないブロックと、まだ入っていないひびは光に何も足さないので計算を省く
      const cracks = float(1).sub(hp).mul(4).toVar();
      const crackGlow = float(0).toVar();
      If(isHard.greaterThan(0.5).and(cracks.greaterThan(0)), () => {
        Loop(4, ({ i }) => {
          const fi = float(i);
          If(fi.greaterThanEqual(cracks), () => {
            Break();
          });
          const ang = b.z.mul(6.28).add(fi.mul(2.1));
          const len = float(BLOCK_W * 0.26).add(fi.mul(BLOCK_W * 0.06));
          const end = vec2(cos(ang), sin(ang).mul(BLOCK_H / BLOCK_W)).mul(len);
          const mid = end.mul(0.5).add(vec2(sin(ang.mul(3.1)), cos(ang.mul(2.3))).mul(BLOCK_H * 0.12));
          const seg = sdSegment(p, vec2(0, 0), mid).min(sdSegment(p, mid, end));
          const on = clamp(cracks.sub(fi), 0, 1);
          crackGlow.addAssign(exp(seg.mul(-90)).mul(on));
        });
      });
      col.addAssign(vec3(1.15, 0.9, 0.6).mul(LOOK.block.crack).mul(crackGlow.mul(isHard).mul(body)));

      // コア
      const pulse = sin(u.time.mul(4.5).add(b.z.mul(6.28))).mul(0.5).add(0.5);
      const coreR = float(BLOCK_H * 0.2);
      // コアの数は、壊したときに出るボールの数に合わせる（ボール入り 1 つ、ハード 2 つ、ボール大量 6 つ、壊れない 0）
      const singleR = p.length().div(coreR);
      const single = exp(singleR.mul(singleR).mul(-1.4)).mul(float(1).sub(isMega).sub(isHard).sub(isSolid));
      const pairR = vec2(abs(p.x).sub(BLOCK_W * 0.16), p.y).length().div(coreR.mul(0.85));
      const pair = exp(pairR.mul(pairR).mul(-1.4)).mul(isHard);
      // ボール大量: 3 列 × 2 行の 6 つ
      const colD = min(abs(p.x), abs(abs(p.x).sub(BLOCK_W * 0.28)));
      const q = vec2(colD, abs(p.y).sub(BLOCK_H * 0.2));
      const quadR = q.length().div(BLOCK_H * 0.12);
      const quad = exp(quadR.mul(quadR).mul(-1.4)).mul(isMega);
      const coreCol = mix(vec3(0.9, 1.0, 1.1), neon(hueT.add(0.1)), 0.35);
      col.addAssign(coreCol.mul(single.add(pair).add(quad.mul(pulse.mul(0.8).add(0.6)))).mul(pulse.mul(LOOK.block.corePulse).add(LOOK.block.core)).mul(body));

      // 当たった直後は白く光る
      const hitFlash = exp(hitAge.mul(-22)).mul(step(0, hitAge));
      const hitFlashStrength = mix(float(LOOK.block.hitFlash), float(LOOK.block.solidHitFlash), isSolid);
      col.addAssign(vec3(1, 1, 1.08).mul(hitFlashStrength).mul(hitFlash).mul(body.add(edge.mul(0.3))));

      // 天井より上（予備の行や、補充で落ちてくる途中の行）は天井の裏に隠す
      const belowCeiling = step(positionWorld.y, FIELD_H);
      const alpha = clamp(body.mul(0.92).add(edge.mul(0.8)), 0, 1).mul(appear.mul(3).clamp(0, 1)).mul(belowCeiling);
      return vec4(col.mul(belowCeiling), alpha);
    })();

    this.mesh = new THREE.Mesh(unitQuad(), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.count = drawCount(0);
  }

  /**
   * ブロックの格子をインスタンスデータへ書き出す。毎フレーム呼んでよく、
   * 前回と同じ格子で version も時刻のずれも同じなら何もしない。
   * @param timeOffset 格子の時刻（当たった時刻・出現時刻）を u.time の時間軸へ直すために足す値
   */
  update(field: BlockSource, timeOffset: number): void {
    if (field === this.source && field.version === this.sourceVersion && timeOffset === this.sourceTimeOffset) return;
    this.source = field;
    this.sourceVersion = field.version;
    this.sourceTimeOffset = timeOffset;
    const d = this.inst.data;
    const stride = this.inst.stride;
    let n = 0;
    for (let row = 0; row < field.rowCount; row++) {
      const bottom = field.rowBottomY(row);
      if (bottom > FIELD_H + CELL_H) break;
      const base = field.slotOf(row) * COLS;
      const cy = bottom + CELL_H / 2;
      for (let col = 0; col < COLS; col++) {
        const i = base + col;
        const type = field.type[i];
        if (type === BlockType.Empty) continue;
        const o = n * stride;
        d[o] = cellCenterX(col);
        d[o + 1] = cy;
        d[o + 2] = type;
        d[o + 3] = field.maxHp[i] > 0 ? field.hp[i] / field.maxHp[i] : 1;
        d[o + 4] = field.hitAt[i] + timeOffset;
        d[o + 5] = field.bornAt[i] + timeOffset;
        d[o + 6] = CELL_RANDOM[i];
        n++;
      }
    }
    for (let k = n; k < drawCount(n); k++) d.fill(0, k * stride, (k + 1) * stride);
    this.mesh.count = drawCount(n);
    this.inst.markDirty(0, drawCount(n));
  }

  /** 次の update で、version が同じでも書き出し直す */
  invalidate(): void {
    this.source = null;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
