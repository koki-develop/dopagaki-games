import { abs, clamp, cos, exp, float, Fn, If, length, max, min, mix, positionLocal, select, sin, smoothstep, sqrt, step, uv, vec2, vec3, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { InstanceBuffer, unitQuad } from '../../../engine/instanced.ts';
import { neon } from '../../../engine/tsl.ts';
import { CEREMONY, RIPPLE, WARP_ARRIVE } from '../config.ts';
import { DISC_LANES, LONG_AGO } from '../fx/discs.ts';
import type { DiscField } from '../fx/discs.ts';
import { SQUARES } from '../rules/position.ts';
import { LOOK } from './look.ts';
import { EDGE_RGB, FACE_RGB, RIM_HUE, STABLE_RGB } from './palette.ts';
import type { ViewUniforms } from './uniforms.ts';

/** 石の半径と厚み（ワールド単位。1 マスは 1） */
const DISC_RADIUS = 0.4;
const DISC_THICKNESS = 0.1;
/** 石 1 枚を描く四角形の一辺。浮いて大きく見える石と、ずれた影が収まる大きさ */
const QUAD = 1.7;
/** 落ち始める高さ（石の半径を 1 とした倍率ではなく、見かけの拡大の元になる高さ） */
const DROP_HEIGHT = { human: 1.8, cpu: 2.6, intro: 1.4 } as const;
/** 高さ 1 あたりの見かけの拡大 */
const HEIGHT_SCALE = 0.22;
/** 終局の並べ直し: 消える前に膨らむ大きさ、現れるときの行き過ぎ（back-ease-out の係数）、消える・現れるときの光 */
const WARP = { bulge: 0.3, overshoot: 2.2, vanishGlow: 0.9, appearGlow: 1.1 } as const;
/**
 * ヒットストップの震えの速さ（Hz）と、強さ 1 のときの振れ幅（ワールド単位）。
 * 60fps の描画で 1 周を 5 フレームで描ける速さに抑え、フレームの間隔と重なって遅く揺れて見える（エイリアス）のを避ける
 */
const SHAKE_HZ = 12;
const SHAKE_REACH = 0.09;
/** 合法手の印が現れきるまでと、消えきるまで（秒） */
const MARKER_FADE = { in: 0.25, out: 0.18 } as const;

/** v の 2 乗（負の値でも正しい。pow(v, 2) は負の底で結果が決まらない） */
const sq = (v: Node<'float'>): Node<'float'> => v.mul(v);

/**
 * 盤の 64 マスの石。マスごとに 1 枚の四角形を描き、DiscField の値と時刻から、頂点とフラグメントのシェーダーで見た目を決める。
 *
 * - 返る: 返る向きに直交する軸のまわりに回る。表と裏の面は楕円に縮み、その間に厚みの面が見える。厚みの面は表側と裏側で色が分かれる
 * - 浮く: 返る途中と落ちてくる間は高く、大きく見え、影が離れてぼける
 * - 落ちる: 人の手は速く、CPU の手は高いところから重く落ちる。着いた瞬間に弾み、人の石は白く光る
 * - ヒットストップ: 打った石とこれから返る石を、実時間で横に震わせる（世界の時刻は止まっている）
 * - 波紋: 盤を伝わる波紋が通ると、石が跳ねる
 * - 終局の並べ直し: 元の位置で白く光りながら縮んで消え、少し間を置いて並べ直す位置に大きく現れ、弾んで戻る
 * - 合法手の印・押している間の予告（半透明の石と、返る石の震え）・確定石の光・終局で数えたときの脈動・負けた側の暗さ
 *
 * 描く順番は盤の上、粒の下。石の外側は透明にする。
 */
export class DiscsView {
  readonly mesh: THREE.Mesh;
  private readonly inst = new InstanceBuffer(SQUARES, DISC_LANES);
  private source: DiscField | null = null;
  private sourceVersion = -1;

  constructor(u: ViewUniforms) {
    const [a, b, c, d, e, f] = this.inst.nodes;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.depthWrite = false;
    material.depthTest = false;

    const t = u.time;
    const PI = Math.PI;

    // ---- 頂点: 位置と高さ ----
    // 終局で並べ直す動き: 元の位置で白く光りながら縮んで消え、消えたまま少し間を置いて、
    // 並べ直す位置に行き過ぎるほど大きく現れて戻る（長さは config.ts の CEREMONY.warp）。
    // 移していない石は移し始めが LONG_AGO なので、とうに現れきった石と同じ（位置は a.xy、大きさ 1、光なし）
    const moveAge = t.sub(d.z);
    const warped = step(CEREMONY.warp.vanish, moveAge);
    const arrived = step(WARP_ARRIVE, moveAge);
    const center = mix(d.xy, a.xy, warped);
    const vanishK = clamp(moveAge.div(CEREMONY.warp.vanish), 0, 1);
    const vanishScale = float(1).add(vanishK.mul(WARP.bulge)).mul(float(1).sub(vanishK.mul(vanishK).mul(vanishK)));
    // 移っている間は appearU が -1 のままで、大きさは 0（見えない）
    const appearAge = moveAge.sub(WARP_ARRIVE);
    const appearU = clamp(appearAge.div(CEREMONY.warp.appear), 0, 1).sub(1);
    const appearScale = float(1)
      .add(appearU.mul(appearU).mul(appearU).mul(WARP.overshoot + 1))
      .add(appearU.mul(appearU).mul(WARP.overshoot));
    const moveScale = mix(vanishScale, appearScale, warped);
    const warpGlow = vanishK.mul(float(1).sub(warped)).mul(step(0, moveAge)).mul(WARP.vanishGlow).add(
      exp(appearAge.mul(-10)).mul(arrived).mul(WARP.appearGlow),
    );

    // 返る
    const flipK = clamp(t.sub(b.x).div(max(b.y, 1e-3)), 0, 1);
    const flipE = flipK.mul(flipK).mul(float(3).sub(flipK.mul(2)));
    const flipAngle = flipE.mul(PI).mul(b.z.mul(2).add(1));
    const flipLift = b.w.mul(sin(flipK.mul(PI)));

    // 落ちる（長さは DiscField が石ごとに書く）
    const kind = c.w;
    const isHuman = step(0.5, kind).mul(step(kind, 1.5));
    const isCpu = step(1.5, kind).mul(step(kind, 2.5));
    const isIntro = step(2.5, kind);
    const dropDur = max(f.y, 1e-3);
    const dropHeight = isHuman.mul(DROP_HEIGHT.human).add(isCpu.mul(DROP_HEIGHT.cpu)).add(isIntro.mul(DROP_HEIGHT.intro));
    const dropAge = t.sub(c.z);
    const dropK = clamp(dropAge.div(dropDur), 0, 1);
    const dropH = float(1).sub(dropK.mul(dropK)).mul(dropHeight);
    const landAge = dropAge.sub(dropDur);
    const landed = step(0, landAge).mul(step(0.5, kind));
    const bounce = exp(landAge.mul(-13)).mul(sin(landAge.mul(44))).mul(isCpu.mul(0.06).add(isHuman.mul(0.22))).mul(landed);
    const impactGlow = exp(landAge.mul(-9)).mul(landed).mul(isHuman).add(warpGlow);
    // 落ち始める前の石は見せない
    const dropVisible = mix(float(1), step(0, dropAge), step(0.5, kind));
    const dropFade = mix(float(1), smoothstep(0, 0.35, dropK), step(0.5, kind));

    // 押している間の予告で震える（PreviewKind.Tremble）
    const previewAge = t.sub(e.z);
    const trembling = step(0.5, f.x).mul(step(f.x, 1.5));
    const tremble = sin(t.mul(41).add(a.x.mul(3.1)).add(a.y.mul(1.7))).mul(0.3).mul(trembling).mul(smoothstep(0, 0.15, previewAge));

    // 波紋で跳ねる（盤の線の光（board.ts）と同じ RIPPLE の値で計算する）。
    // 頂点の式は Fn の外で組むので、ループや代入を使わず、枠の数だけ式を足し合わせる
    let rippleLift: Node<'float'> = float(0);
    for (let i = 0; i < RIPPLE.slots; i++) {
      const r = u.ripples.element(i);
      const age = t.sub(r.z);
      const front = center.sub(r.xy).length().sub(age.mul(RIPPLE.speed));
      const alive = step(0, age).mul(step(age, RIPPLE.life));
      rippleLift = rippleLift.add(exp(sq(front).mul(-RIPPLE.width)).mul(exp(age.mul(-RIPPLE.decay))).mul(r.w).mul(alive));
    }

    // 終局で数えた瞬間の脈動
    const countAge = t.sub(f.z);
    const countPop = exp(countAge.mul(-9)).mul(step(0, countAge));

    // ヒットストップ: 打った石（震えの中心のマス）と、返り始める前の石だけを震わせる
    const pendingFlip = step(t, b.x).mul(step(1e-4, b.y));
    const atHit = step(center.sub(u.hit.xy).length(), 0.1);
    const shaking = max(pendingFlip, atHit);
    const shakeX = sin(u.real.mul(Math.PI * 2 * SHAKE_HZ)).mul(u.hit.z).mul(SHAKE_REACH).mul(shaking);

    const height = flipLift.add(dropH).add(rippleLift.mul(0.4)).add(countPop.mul(0.35));
    const scale = float(1).add(height.mul(HEIGHT_SCALE)).add(bounce).mul(moveScale);
    // 描くもののないマス（石も、消えかけを含む合法手の印も、押している間の予告もない）は四角形を潰して、フラグメントを走らせない
    const hasDisc = step(-0.5, max(a.z, a.w));
    const hasPreview = step(0.5, f.x);
    const hasMarker = step(t, e.y.add(MARKER_FADE.out));
    const drawn = max(max(hasDisc, hasPreview), hasMarker);
    material.positionNode = vec3(center.add(vec2(shakeX, 0)).add(positionLocal.xy.mul(QUAD).mul(drawn)), 0);

    const vScale = max(scale, 1e-3).toVarying('vDiscScale');
    const vPresence = clamp(moveScale, 0, 1).toVarying('vDiscPresence');
    const vHeight = height.toVarying('vDiscHeight');
    const vAngle = flipAngle.add(tremble).toVarying('vDiscAngle');
    const vVisible = dropVisible.toVarying('vDiscVisible');
    const vFade = dropFade.toVarying('vDiscFade');
    const vCountPop = countPop.toVarying('vDiscCount');
    const vImpact = impactGlow.toVarying('vDiscImpact');

    material.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(QUAD).toVar();
      const R = DISC_RADIUS;
      const exists = step(-0.5, max(a.z, a.w)).mul(vVisible);

      // 影: 浮くほど離れてぼけ、薄くなる
      const h = vHeight;
      const shOff = vec2(0.05, -0.07).add(vec2(0.1, -0.16).mul(h));
      const shR = float(R).mul(float(1).add(h.mul(0.2)));
      const soft = float(0.04).add(h.mul(0.1));
      const sd = p.sub(shOff).length().sub(shR);
      const shadowA = float(1).sub(smoothstep(soft.negate(), soft, sd)).mul(0.6).div(float(1).add(h.mul(1.4))).mul(exists).mul(vFade).mul(vPresence);

      // 石: 返る向き dir の成分だけ cos(角度) で縮む
      const q = p.div(vScale);
      const dirLen = max(length(c.xy), 1e-4);
      const dir = c.xy.div(dirLen);
      const axis = vec2(dir.y.negate(), dir.x);
      const cT = cos(vAngle);
      const sT = sin(vAngle);
      const ac = max(abs(cT), 0.03);
      const along = q.dot(axis);
      const across = q.dot(dir);
      const frontUp = step(0, cT);
      // 見えている面の中心のずれ（厚みの半分 × sin）。表の面は -sin、裏の面は +sin の側にある
      const faceOff = float(-DISC_THICKNESS / 2).mul(sT).mul(select(frontUp.greaterThan(0.5), float(1), float(-1)));
      const un = along.div(R);
      const vn = across.sub(faceOff).div(ac.mul(R));
      const faceD = un.mul(un).add(vn.mul(vn));
      const rimV = max(abs(across).sub(abs(faceOff)), 0).div(ac.mul(R));
      const rimD = un.mul(un).add(rimV.mul(rimV));
      const aa = float(0.07);
      const inFace = float(1).sub(smoothstep(float(1).sub(aa), float(1).add(aa), faceD));
      const inBody = float(1).sub(smoothstep(float(1).sub(aa), float(1).add(aa), rimD));

      // 色: 見えている面は、表が見えていれば返る前の色、裏なら返った後の色
      const faceIdx = mix(a.w, a.z, frontUp);
      // 厚みの面は、表の面に近い側が返る前の色
      const frontSide = step(0, across.mul(sT).negate());
      const edgeIdx = mix(a.w, a.z, frontSide);

      const faceBase = mix(vec3(...FACE_RGB[0]).mul(LOOK.disc.blackFace), vec3(...FACE_RGB[1]).mul(LOOK.disc.whiteFace), faceIdx);
      const rimCol = mix(neon(RIM_HUE[0]), neon(RIM_HUE[1]), faceIdx);
      const edgeCol = mix(vec3(...EDGE_RGB[0]), vec3(...EDGE_RGB[1]), edgeIdx).mul(LOOK.disc.edge);
      const r = sqrt(faceD);
      // 光は画面の左上から当てる。面の上の点を画面の向きへ戻して（返る向きによらず）陰影を付ける
      const light = vec2(-0.55, 0.83);
      const onFace = axis.mul(un).add(dir.mul(vn));
      // 面: 中央が明るく縁へ暗くなるドーム。傾くほど暗い
      const dome = float(0.55).add(float(1).sub(min(faceD, 1)).sqrt().mul(0.45));
      const tiltShade = float(0.55).add(ac.mul(0.45));
      // 縁の面取り: 光の側が明るく、反対側が暗い
      const bevelBand = smoothstep(0.7, 0.95, r).mul(float(1).sub(smoothstep(0.97, 1.02, r)));
      const bevel = onFace.dot(light).div(max(r, 1e-3)).mul(bevelBand);
      // 照り返し: 光の側に寄った柔らかい光と、小さく鋭い光
      const specSoft = exp(onFace.sub(light.mul(0.35)).dot(onFace.sub(light.mul(0.35))).mul(-5));
      const specSharp = exp(onFace.sub(light.mul(0.45)).dot(onFace.sub(light.mul(0.45))).mul(-60));
      const spec = specSoft.mul(0.35).add(specSharp.mul(0.9)).mul(LOOK.disc.specular).mul(ac);
      // ネオンの縁: 外周に沿う細い光
      const ring = exp(sq(r.sub(0.94).div(0.035)).negate()).mul(LOOK.disc.rim);
      const faceCol = faceBase
        .mul(dome)
        .mul(tiltShade)
        .mul(float(1).add(bevel.mul(0.9)))
        .add(rimCol.mul(ring))
        .add(vec3(1, 1, 1).mul(spec));

      // 確定石: 淡い金の結晶の光。確定した瞬間は強く光る
      // 時刻が LONG_AGO のままなら、まだ起きていない
      const stableAge = t.sub(e.w);
      const stableOn = step(0, stableAge).mul(step(LONG_AGO / 2, e.w));
      const stableRing = exp(sq(r.sub(0.8).div(0.05)).negate());
      const sparkle = sin(t.mul(3).add(un.mul(9)).add(vn.mul(7))).mul(0.5).add(0.5).pow(6);
      const stableGlow = stableRing.mul(float(0.3).add(sparkle.mul(0.5)).add(exp(stableAge.mul(-5)).mul(2.5))).mul(stableOn).mul(LOOK.disc.stable);

      const countBoost = float(1).add(vCountPop.mul(1.6));
      const dimAge = t.sub(f.w);
      const dim = float(1).sub(smoothstep(0, 0.6, dimAge).mul(step(0, dimAge)).mul(step(LONG_AGO / 2, f.w)).mul(0.68));
      const discCol = mix(edgeCol, faceCol.add(vec3(...STABLE_RGB).mul(stableGlow)), inFace)
        .mul(countBoost)
        .mul(dim)
        .add(vec3(1, 1, 1).mul(vImpact.mul(LOOK.disc.impact)));
      const discA = inBody.mul(exists).mul(vFade);
      // 縁のにじみ: 石の外側へ、縁の色の光が薄く広がる
      const outside = sqrt(rimD).sub(1).max(0);
      const halo = exp(sq(outside.div(0.16)).negate()).mul(float(1).sub(inBody)).mul(exists).mul(vFade).mul(LOOK.disc.halo).mul(dim);

      // 合法手の印（石のないマス）: 人の石の縁の色の輪。フィーバーの間はビートで脈打つ（u.beat はフィーバーの外では 0）
      const legalOn = smoothstep(e.x, e.x.add(MARKER_FADE.in), t).mul(float(1).sub(smoothstep(e.y, e.y.add(MARKER_FADE.out), t)));
      const pr = p.length();
      const markR = float(0.12).add(u.beat.mul(0.025));
      const mark = exp(sq(pr.sub(markR).div(0.025)).negate()).add(exp(pr.mul(pr).mul(-260)).mul(0.5));
      const markerCol = neon(u.markerHue).mul(LOOK.disc.marker);
      const markerA = clamp(mark.mul(legalOn).mul(float(1).sub(exists)), 0, 1);

      // 押している間の半透明の石（PreviewKind.GhostBlack・GhostWhite）
      const ghostOn = step(1.5, f.x).mul(smoothstep(0, 0.1, previewAge));
      const ghostIdx = step(2.5, f.x);
      const ghostDisc = float(1).sub(smoothstep(R - 0.03, R + 0.03, pr));
      const ghostPulse = sin(t.mul(9)).mul(0.12).add(0.5);
      // 黒い石の半透明は暗い盤に溶けるので、面にも縁の色を薄く混ぜる
      const ghostRim = mix(neon(RIM_HUE[0]), neon(RIM_HUE[1]), ghostIdx);
      const ghostCol = mix(vec3(...FACE_RGB[0]).mul(0.12), vec3(...FACE_RGB[1]).mul(0.55), ghostIdx)
        .add(ghostRim.mul(0.22))
        .add(ghostRim.mul(exp(sq(pr.sub(R * 0.92).div(0.035)).negate()).mul(1.2)));
      const ghostA = ghostDisc.mul(ghostOn).mul(ghostPulse).mul(LOOK.disc.ghost).mul(float(1).sub(exists));

      // 重ねる: 印と半透明の石 → 影 → 石
      const outCol = vec3(0, 0, 0).toVar();
      const outA = float(0).toVar();
      If(markerA.add(ghostA).greaterThan(0), () => {
        const ga = min(ghostA.add(markerA), 1);
        outCol.assign(ghostCol.mul(ghostA).add(markerCol.mul(markerA)).div(max(ga, 1e-4)));
        outA.assign(ga);
      });
      // 影は黒なので、下にある色を暗くするだけ。縁のにじみは影の上に重ねる
      const shadeA = outA.add(shadowA.mul(float(1).sub(outA)));
      const shadeCol = outCol.mul(outA).div(max(shadeA, 1e-4));
      const underA = halo.add(shadeA.mul(float(1).sub(halo)));
      const underCol = rimCol.mul(halo).add(shadeCol.mul(shadeA).mul(float(1).sub(halo))).div(max(underA, 1e-4));
      const finalA = discA.add(underA.mul(float(1).sub(discA)));
      const finalCol = discCol.mul(discA).add(underCol.mul(underA).mul(float(1).sub(discA))).div(max(finalA, 1e-4));
      return vec4(finalCol, finalA);
    })();

    this.mesh = new THREE.Mesh(unitQuad(), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.count = SQUARES;
  }

  /** 石の状態を GPU へ送る。毎フレーム呼んでよく、前回と同じ版なら何もしない */
  update(field: DiscField): void {
    if (field === this.source && field.version === this.sourceVersion) return;
    this.source = field;
    this.sourceVersion = field.version;
    this.inst.data.set(field.data);
    this.inst.markDirty(0, SQUARES);
  }

  /** レンダラーを作り直した。次の update で送り直す */
  invalidate(): void {
    this.source = null;
    this.inst.markAllDirty();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
