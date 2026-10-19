import { abs, clamp, cos, exp, float, Fn, max, mix, positionLocal, sin, smoothstep, sqrt, step, texture, uv, vec2, vec3, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { InstanceBuffer, unitQuad } from '../../../engine/instanced.ts';
import { PRESENT_LONG_AGO } from '../../../juice/frame-time.ts';
import { CHIP_VALUES } from '../denominations.ts';
import { CHIP_FADE, CHIP_LANES, CHIP_SLOTS } from '../fx/chips.ts';
import type { ChipField } from '../fx/chips.ts';
import { CHIP_R, CHIP_THICKNESS } from '../geometry.ts';
import { paintedTexture } from './canvas.ts';
import { CHIP_ATLAS_H, CHIP_ATLAS_W, CHIP_CELL, paintChipAtlas } from './chip-art.ts';
import { LOOK } from './look.ts';
import { GOLD_RGB } from './palette.ts';
import type { ViewUniforms } from './uniforms.ts';

/** チップ 1 枚を描く四角形の一辺（側面と影が収まる大きさ） */
const QUAD = CHIP_R * 2 * 1.7;
/** 側面の厚み（半径を 1 とした長さ） */
const SIDE = CHIP_THICKNESS / CHIP_R;
/** アトラスの 1 枚の中で、チップの絵が占める半径の割合（縁の 1 ピクセルを除く） */
const FACE_FILL = (CHIP_CELL / 2 - 1) / (CHIP_CELL / 2);
const DENOMINATIONS = CHIP_VALUES.length;
/** 勝ったラウンドの払い戻しのチップを光らせる長さ（present の秒） */
const SHINE_LIFE = 0.7;

const sq = (v: Node<'float'>): Node<'float'> => v.mul(v);
const since = (t: Node<'float'>, at: Node<'float'>) => ({ age: t.sub(at), happened: step(PRESENT_LONG_AGO / 2, at).mul(step(at, t)) });

/**
 * 卓のチップ。少し手前から見下ろしたように、上の面の円と、その下の厚みの側面を描く。積むと 1 枚ずつの側面が縞に見える。
 * - 上の面: カジノのチップの絵柄（chip-art.ts で描いたアトラス）を、枠ごとの向きで回して貼る
 * - 側面: 上の面の縁の模様を同じ角度で読み、円柱のように真ん中を明るく、端と下を暗く塗る
 * - 飛ぶ間は大きく見え、影が離れる。影は別のメッシュ（shadow）で、すべてのチップより先に描く（積んだ上のチップの影で、下のチップを暗くしない）
 * - 着いた瞬間に弾み、ヒットストップで震える
 * - 暗くし（取られたチップ）、光らせ（勝ったラウンドの払い戻し: 上の面を光の筋が横切り、縁が金に光る）、薄くして消える
 */
export class ChipsView {
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  private readonly inst = new InstanceBuffer(CHIP_SLOTS, CHIP_LANES);
  private readonly atlas = paintedTexture(CHIP_ATLAS_W, CHIP_ATLAS_H, paintChipAtlas);
  private source: ChipField | null = null;
  private sourceVersion = -1;

  constructor(u: ViewUniforms) {
    const [a, b, c, e] = this.inst.nodes;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.depthWrite = false;
    material.depthTest = false;
    const shadowMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true });
    shadowMaterial.depthWrite = false;
    shadowMaterial.depthTest = false;
    const t = u.time;

    const k = clamp(t.sub(b.x).div(max(b.y, 1e-3)), 0, 1);
    const eased = float(1).sub(sq(float(1).sub(k)).mul(float(1).sub(k)));
    const center = mix(a.xy, a.zw, eased);
    const height = b.z.mul(sin(k.mul(Math.PI)));
    const land = since(t, c.z);
    const bounce = exp(land.age.mul(-16)).mul(sin(land.age.mul(48))).mul(0.1).mul(land.happened);
    const shown = step(0.5, b.w);
    const scale = float(1).add(height.mul(0.3)).add(bounce).mul(shown);
    const shakeX = sin(u.real.mul(Math.PI * 2 * 12)).mul(u.hitShake).mul(0.06);
    material.positionNode = vec3(center.add(positionLocal.xy.mul(QUAD).mul(scale)).add(vec2(shakeX, 0)), 0);
    shadowMaterial.positionNode = material.positionNode;

    const fade = since(t, c.x);
    const dim = since(t, c.y);
    const shine = since(t, c.w);
    const vAlive = float(1).sub(smoothstep(0, CHIP_FADE, fade.age).mul(fade.happened)).toVarying('vChipAlive');
    const vDim = mix(float(1), float(LOOK.chip.dim), smoothstep(0, 0.2, dim.age).mul(dim.happened)).toVarying('vChipDim');
    const vShine = clamp(shine.age.div(SHINE_LIFE), 0, 1).mul(shine.happened).toVarying('vChipShine');
    const vShineOn = shine.happened.mul(exp(shine.age.mul(-1.5))).toVarying('vChipShineOn');
    const vFace = b.w.sub(1).toVarying('vChipFace');
    const vSpin = e.x.toVarying('vChipSpin');
    const vHeight = height.toVarying('vChipHeight');

    material.colorNode = Fn(() => {
      // 半径を 1 とした、チップの中心からの位置
      const p = uv().sub(0.5).mul(QUAD).div(CHIP_R).toVar();
      const aa = float(0.04);
      const topA = float(1).sub(smoothstep(float(1).sub(aa), float(1).add(aa), p.length())).toVar();
      // 側面: 上の面の円の下側の縁から、厚みの分だけ下までの帯
      const rim = sqrt(max(float(1).sub(p.x.mul(p.x)), 0));
      const sideA = float(1)
        .sub(smoothstep(float(1).sub(aa), float(1).add(aa), abs(p.x)))
        .mul(smoothstep(rim.negate().sub(SIDE).sub(aa), rim.negate().sub(SIDE).add(aa), p.y))
        .mul(step(p.y, 0))
        .mul(float(1).sub(topA));

      // アトラスを読む: 上の面はその点を、側面は真上の縁の点を、枠ごとの向きで回して読む。テクスチャは分岐の外で読む
      const cs = cos(vSpin);
      const sn = sin(vSpin);
      const rot = (x: Node<'float'>, y: Node<'float'>) => vec2(x.mul(cs).sub(y.mul(sn)), x.mul(sn).add(y.mul(cs)));
      const cellUv = (q: Node<'vec2'>) => vec2(vFace.add(0.5).add(q.x.mul(0.5 * FACE_FILL)).div(DENOMINATIONS), float(0.5).add(q.y.mul(0.5 * FACE_FILL)));
      const topCol = texture(this.atlas, cellUv(rot(p.x, p.y))).rgb;
      const edgeX = clamp(p.x, -0.999, 0.999).mul(0.95);
      const sideCol = texture(this.atlas, cellUv(rot(edgeX, rim.negate().mul(0.95)))).rgb;
      const below = clamp(rim.negate().sub(p.y).div(SIDE), 0, 1);
      const cylinder = float(0.5).add(float(1).sub(p.x.mul(p.x)).mul(0.3)).mul(float(1).sub(below.mul(0.25)));
      const col = mix(sideCol.mul(cylinder), topCol, topA).mul(LOOK.chip.face).mul(vDim).toVar();

      // 光らせる: 上の面を斜めの光の筋が横切り、縁が金に光る
      const sweep = exp(sq(p.x.add(p.y).sub(vShine.mul(4).sub(2)).div(0.35)).negate()).mul(step(0.001, vShine)).mul(float(1).sub(vShine));
      const rimGlow = exp(sq(p.length().sub(1).div(0.12)).negate());
      col.addAssign(vec3(...GOLD_RGB).mul(sweep.mul(topA).add(rimGlow.mul(vShineOn).mul(0.6)).mul(LOOK.chip.shine)));
      return vec4(col, clamp(topA.add(sideA), 0, 1).mul(vAlive));
    })();

    // 影: 浮くほど離れて薄くなる
    shadowMaterial.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(QUAD).div(CHIP_R);
      const off = vec2(0.14, float(-0.3).sub(SIDE)).mul(float(1).add(vHeight.mul(1.5)));
      const sr = p.sub(off).length();
      const shadowA = float(1).sub(smoothstep(0.85, 1.25, sr)).mul(LOOK.chip.shadow).div(float(1).add(vHeight.mul(1.5)));
      return vec4(0, 0, 0, shadowA.mul(vAlive));
    })();

    const geometry = unitQuad();
    this.shadow = new THREE.Mesh(geometry, shadowMaterial);
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 24;
    this.shadow.count = CHIP_SLOTS;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 25;
    this.mesh.count = CHIP_SLOTS;
  }

  /** チップの状態を GPU へ送る。前回と同じ版なら何もしない */
  update(field: ChipField): void {
    if (field === this.source && field.version === this.sourceVersion) return;
    this.source = field;
    this.sourceVersion = field.version;
    this.inst.data.set(field.data);
    this.inst.markDirty(0, CHIP_SLOTS);
  }

  /** レンダラーを作り直した。次の update で送り直す */
  invalidate(): void {
    this.source = null;
    this.inst.markAllDirty();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    (this.shadow.material as THREE.Material).dispose();
    this.atlas.dispose();
  }
}
