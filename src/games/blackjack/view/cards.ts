import { abs, clamp, cos, exp, float, floor, Fn, max, mix, positionLocal, select, sin, smoothstep, step, texture, uv, vec2, vec3, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { InstanceBuffer, unitQuad } from '../../../engine/instanced.ts';
import { neon, sdRoundBox } from '../../../engine/tsl.ts';
import { PRESENT_LONG_AGO } from '../../../juice/frame-time.ts';
import { CARD_LANES, CARD_SLOTS } from '../fx/cards.ts';
import type { CardField } from '../fx/cards.ts';
import { CARD_H, CARD_W } from '../geometry.ts';
import { ATLAS_COLS, ATLAS_ROWS, BACK_CELL, CORNER_RATIO, createCardAtlas, paintCardFaces } from './card-art.ts';
import { loadCardFaces } from './card-faces.ts';
import { LOOK } from './look.ts';
import { GOLD_RGB } from './palette.ts';
import type { ViewUniforms } from './uniforms.ts';

/** カード 1 枚を描く四角形の余白（影と光が収まるように、カードの外へ広げる量） */
const MARGIN = 0.7;
const QUAD_W = CARD_W + MARGIN * 2;
const QUAD_H = CARD_H + MARGIN * 2;
const HALF_W = CARD_W / 2;
const HALF_H = CARD_H / 2;
/** 角の丸み（本物のトランプと同じく、幅の 6% ほど） */
const CORNER = CARD_W * CORNER_RATIO;
/** 高さ 1 あたりの見かけの拡大 */
const HEIGHT_SCALE = 0.22;
/** ヒットストップの震えの速さ（Hz）と、強さ 1 のときの振れ幅（ワールド単位）。60fps で見分けられる速さに抑える */
const SHAKE_HZ = 12;
const SHAKE_REACH = 0.1;
/** 捨てたカードが消えきるまで */
const FADE = 0.25;

/** v の 2 乗（負の値でも正しい） */
const sq = (v: Node<'float'>): Node<'float'> => v.mul(v);

/** 時刻 at（LONG_AGO なら起きていない）から経った時間と、起きたか（1 / 0） */
const since = (t: Node<'float'>, at: Node<'float'>) => ({ age: t.sub(at), happened: step(PRESENT_LONG_AGO / 2, at).mul(step(at, t)) });

/**
 * 卓のカード。1 枚ごとに 1 枚の四角形を描き、CardField の値と時刻から、頂点とフラグメントのシェーダーで見た目を決める。
 *
 * - 飛ぶ: 動き始めの場所から動いた先へ、速く出てゆっくり止まる。飛ぶ間は高く、大きく見え、影が離れてぼける
 * - 返す: 横に縮んで裏から表へ（表から裏へ）。半分を過ぎたら返した後の面を描く
 * - 着く: 叩きつけた瞬間に弾み、白く光る
 * - 表と裏: 本物のトランプの絵柄（card-art.ts で描いたアトラス。表は loadFaces で読み込んでから描く）を貼り、紙の縁をわずかに暗くする。返している間は面が光から逸れて暗くなる
 * - 確かめる: 伏せたカードの角を持ち上げ、光の筋が走る
 * - 暗くする（負けた手）、縁から光らせる（勝った手は金、ブラックジャックは虹色、21 はシアン）、ヒットストップで震える、薄くして消える
 *
 * 描く順番は枠の順（後から配ったカードが上）。
 */
export class CardsView {
  readonly mesh: THREE.Mesh;
  private readonly inst = new InstanceBuffer(CARD_SLOTS, CARD_LANES);
  private source: CardField | null = null;
  private sourceVersion = -1;
  private readonly atlas = createCardAtlas();

  constructor(u: ViewUniforms) {
    const [a, b, c, d, e, f] = this.inst.nodes;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.depthWrite = false;
    material.depthTest = false;
    const t = u.time;

    // ---- 頂点: 位置・向き・大きさ ----
    const k = clamp(t.sub(b.x).div(max(b.y, 1e-3)), 0, 1);
    const eased = float(1).sub(sq(float(1).sub(k)).mul(float(1).sub(k)));
    const center = mix(a.xy, a.zw, eased);
    const rot = mix(b.z, b.w, eased);
    const height = d.z.mul(sin(k.mul(Math.PI)));
    const land = since(t, e.x);
    const bounce = exp(land.age.mul(-14)).mul(sin(land.age.mul(42))).mul(0.06).mul(land.happened);
    const peek = since(t, f.x);
    const peekK = clamp(peek.age.div(max(f.w, 1e-3)), 0, 1).mul(peek.happened);
    const peekLift = sin(peekK.mul(Math.PI)).mul(0.08);
    const scale = mix(d.x, d.y, eased).mul(float(1).add(height.mul(HEIGHT_SCALE)).add(bounce).add(peekLift));
    const shakeX = sin(u.real.mul(Math.PI * 2 * SHAKE_HZ)).mul(u.hitShake).mul(SHAKE_REACH).mul(f.y);
    const visible = d.w;
    const cr = cos(rot);
    const sr = sin(rot);
    const local = positionLocal.xy.mul(vec2(QUAD_W, QUAD_H)).mul(scale).mul(visible);
    const rotated = vec2(local.x.mul(cr).sub(local.y.mul(sr)), local.x.mul(sr).add(local.y.mul(cr)));
    material.positionNode = vec3(center.add(rotated).add(vec2(shakeX, 0)), 0);

    // 返す: 角度 0〜π。cos で横に縮む
    const flipK = clamp(t.sub(c.x).div(max(c.y, 1e-3)), 0, 1);
    const flipE = flipK.mul(flipK).mul(float(3).sub(flipK.mul(2)));
    const squeeze = max(abs(cos(flipE.mul(Math.PI))), 0.02);
    const face = select(flipE.greaterThan(0.5), c.w, c.z);
    // 影はワールドの右下へ落とす。カードの向きを戻して、カードの座標で持つ
    const shadowWorld = vec2(float(0.06).add(height.mul(0.14)), float(-0.1).sub(height.mul(0.2)));
    const shadow = vec2(shadowWorld.x.mul(cr).add(shadowWorld.y.mul(sr)), shadowWorld.y.mul(cr).sub(shadowWorld.x.mul(sr)));

    const vSqueeze = squeeze.toVarying('vCardSqueeze');
    const vFace = face.toVarying('vCardFace');
    const vHeight = height.toVarying('vCardHeight');
    const vShadow = shadow.div(max(scale, 1e-3)).toVarying('vCardShadow');
    const vLand = exp(land.age.mul(-10)).mul(land.happened).toVarying('vCardLand');
    const vPeek = peekK.toVarying('vCardPeek');

    // 状態による明るさの変化（暗くする・光らせる・消す）
    const dim = since(t, e.y);
    const dimK = smoothstep(0, 0.4, dim.age).mul(dim.happened);
    const glow = since(t, e.z);
    const glowOn = smoothstep(0, 0.15, glow.age).mul(glow.happened);
    const fade = since(t, f.z);
    const alive = float(1).sub(smoothstep(0, FADE, fade.age).mul(fade.happened));
    const vDim = mix(float(1), float(LOOK.card.dim), dimK).toVarying('vCardDim');
    const vGlow = exp(glow.age.mul(-3)).mul(1.5).add(0.6).mul(glowOn).toVarying('vCardGlow');
    const vKind = e.w.toVarying('vCardGlowKind');
    const vAlive = alive.mul(visible).toVarying('vCardAlive');

    material.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(vec2(QUAD_W, QUAD_H)).toVar();
      const aa = float(0.02);
      // 返している間は横に縮む。カードの座標へ戻して描く
      const q = vec2(p.x.div(vSqueeze), p.y).toVar();
      const body = sdRoundBox(q, vec2(HALF_W, HALF_H), CORNER).toVar();
      const cardA = float(1).sub(smoothstep(aa.negate(), aa, body));

      const isBack = step(vFace, -0.5);
      // アトラスのどの絵か（表は 0〜51、裏は BACK_CELL）と、カードの中の位置。テクスチャは分岐の外で読む
      const cell = select(isBack.greaterThan(0.5), float(BACK_CELL), max(vFace, 0)).add(1e-3);
      const row = floor(cell.div(ATLAS_COLS));
      const col = floor(cell.sub(row.mul(ATLAS_COLS)));
      const lu = clamp(q.x.div(CARD_W).add(0.5), 0.002, 0.998);
      const lv = clamp(q.y.div(CARD_H).add(0.5), 0.002, 0.998);
      const atlasUv = vec2(col.add(lu).div(ATLAS_COLS), float(ATLAS_ROWS - 1).sub(row).add(lv).div(ATLAS_ROWS));
      const art = texture(this.atlas, atlasUv).rgb;
      // 紙: 上をわずかに明るく、縁を暗くし、返している間は光から逸れて暗くなる
      const edge = smoothstep(-0.06, 0, body);
      const light = float(0.94).add(lv.mul(0.06)).mul(float(1).sub(edge.mul(0.28))).mul(float(0.72).add(vSqueeze.mul(0.28)));
      const glint = exp(sq(q.x.add(q.y.mul(0.6)).sub(vPeek.mul(3.4).sub(1.7)).div(0.14)).negate()).mul(sin(vPeek.mul(Math.PI))).mul(isBack);

      // 光らせ方: 1 は金、2 は虹色（実時間で回る）、3 はシアン。カードの縁の内側と外へにじませる
      const glowCol = select(vKind.lessThan(1.5), vec3(...GOLD_RGB), select(vKind.lessThan(2.5), neon(u.real.mul(0.6).add(q.y.mul(0.25))), neon(0.5)));
      const inner = exp(sq(body.add(0.02).div(0.04)).negate()).mul(vGlow).mul(LOOK.card.win);
      const cardCol = art
        .mul(light)
        .mul(LOOK.card.paper)
        .mul(vDim)
        .add(vec3(1, 0.95, 0.85).mul(glint.mul(0.5)))
        .add(glowCol.mul(inner))
        .add(vec3(1, 1, 1).mul(vLand.mul(LOOK.card.land)));

      // カードの下: 影（黒）と、光らせたカードの外へにじむ光
      const outside = max(body, 0);
      const aura = exp(sq(outside.div(0.22)).negate()).mul(step(0.001, outside)).mul(vGlow).mul(LOOK.card.win);
      const soft = float(0.06).add(vHeight.mul(0.12));
      const sd = sdRoundBox(vec2(p.x.sub(vShadow.x).div(vSqueeze), p.y.sub(vShadow.y)), vec2(HALF_W, HALF_H), CORNER);
      const shadowA = float(1).sub(smoothstep(soft.negate(), soft, sd)).mul(LOOK.card.shadow).div(float(1).add(vHeight.mul(1.2)));
      const underA = clamp(aura.add(shadowA.mul(float(1).sub(aura))), 0, 1);
      const underCol = glowCol.mul(aura).div(max(underA, 1e-4));
      const finalA = cardA.add(underA.mul(float(1).sub(cardA)));
      const finalCol = cardCol.mul(cardA).add(underCol.mul(underA).mul(float(1).sub(cardA))).div(max(finalA, 1e-4));
      return vec4(finalCol, finalA.mul(vAlive));
    })();

    this.mesh = new THREE.Mesh(unitQuad(), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.count = CARD_SLOTS;
  }

  /** 表の絵を読み込んでアトラスに描く。DOM のない環境では何もしない。読み込めなければ LoadError で失敗する */
  async loadFaces(): Promise<void> {
    const faces = await loadCardFaces();
    if (faces) paintCardFaces(this.atlas, faces);
  }

  /** カードの状態を GPU へ送る。毎フレーム呼んでよく、前回と同じ版なら何もしない */
  update(field: CardField): void {
    if (field === this.source && field.version === this.sourceVersion) return;
    this.source = field;
    this.sourceVersion = field.version;
    this.inst.data.set(field.data);
    this.inst.markDirty(0, CARD_SLOTS);
  }

  /** レンダラーを作り直した。次の update で送り直す */
  invalidate(): void {
    this.source = null;
    this.inst.markAllDirty();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.atlas.dispose();
  }
}
