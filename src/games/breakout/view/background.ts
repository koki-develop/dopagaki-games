import {
  abs,
  exp,
  float,
  Fn,
  fract,
  fwidth,
  If,
  Loop,
  max,
  min,
  mix,
  positionWorld,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import { neon } from '../../../engine/tsl.ts';
import { clamp01 } from '../../../shared/math.ts';
import { DANGER_Y, FIELD_H, FIELD_W, PIT_TOP } from '../config.ts';
import { WALL_HIT_SLOTS } from '../fx/fx-state.ts';
import { DANGER_LINE, dangerReach, farWallNegligible, SHOCK_RING, shockAge, shockReach, WALL_GLOW_BAND } from './background-reach.ts';
import { DENSITY_H, DENSITY_W, DensityGrid, isWarpActive, WARP_TIER_FULL, WARP_TIER_START } from './density.ts';
import { LOOK } from './look.ts';
import type { ViewUniforms } from './uniforms.ts';
import { WALL_GLOW, WALL_WAVE, wallWaveBounds } from './wall-wave.ts';
import type { WallHit, WallWaveBounds } from './wall-wave.ts';

const GRID = 0.5;

/** シェーダーの smoothstep と同じ式 */
function smoothstepOf(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/**
 * 背景。暗いグラデーションの上にネオンのグリッドを描き、壁・天井・危険ライン・衝撃波もここで描く。
 * - ビートで脈動する（段階 1 以上）
 * - 色相がゆっくり回る（段階 2 以上。hue uniform で制御）
 * - ボールの密度に反応して歪む（段階 3 以上）
 *
 * 壁の揺れ・壁と天井の光・危険ライン・衝撃波は、それが見える範囲（CPU で求めて uniform で渡す）の画素だけで計算する。
 * 範囲の外で省いた分の誤差は background-reach.ts と wall-wave.ts で見積もる。
 * 密度テクスチャは歪みが効いている間だけ読み、その間だけ送る。
 */
export class BackgroundView {
  readonly mesh: THREE.Mesh;
  private readonly u: ViewUniforms;
  private readonly density = new DensityGrid();
  private readonly densityTex: THREE.DataTexture;
  // 以下の uniform は update() が u から求める。作ったときにも 1 回求める
  /** x がこれより小さい画素と、waveRight より大きい画素だけで壁の揺れを計算する */
  private readonly waveLeft = uniform(0);
  private readonly waveRight = uniform(0);
  private readonly bounds: WallWaveBounds = { left: 0, right: 0, shiftLeft: 0, shiftRight: 0 };
  /** 左の壁・右の壁・天井からの距離が、それぞれ glowReachLeft・glowReachRight・WALL_GLOW_BAND より近い画素だけで光を計算する */
  private readonly glowReachLeft = uniform(0);
  private readonly glowReachRight = uniform(0);
  /** 危険ラインからこの距離より近い画素だけで計算する */
  private readonly dangerBand = uniform(0);
  /** 衝撃波の前線からこの距離より近い画素だけで計算する。0 以下なら計算しない */
  private readonly shockBand = uniform(0);
  /** 1 なら、壁の揺れを画素に近い側の壁の記録だけで計算する。0 ならすべての記録で計算する */
  private readonly nearSideOnly = uniform(0);
  /** グリッドの明るさのうち、uniform だけで決まる分 */
  private readonly gridLevel = uniform(0);
  /** 下地に足す色の強さ */
  private readonly tint = uniform(0);
  /** 衝撃波が時間とともに弱まる倍率 e^(-decay·age) */
  private readonly shockFade = uniform(0);

  constructor(u: ViewUniforms) {
    this.u = u;
    this.densityTex = new THREE.DataTexture(this.density.data, DENSITY_W, DENSITY_H, THREE.RedFormat, THREE.UnsignedByteType);
    this.densityTex.magFilter = THREE.LinearFilter;
    this.densityTex.minFilter = THREE.LinearFilter;
    this.densityTex.wrapS = THREE.ClampToEdgeWrapping;
    this.densityTex.wrapT = THREE.ClampToEdgeWrapping;
    this.densityTex.needsUpdate = true;

    const tex = this.densityTex;
    const colorNode = Fn(() => {
      const p = positionWorld.xy.toVar();
      // 左右の壁の間で天井より下。フィールドの下端より下も、グリッドはフィールドと同じに描く
      const inWalls = step(0, p.x).mul(step(p.x, FIELD_W)).mul(step(p.y, FIELD_H)).toVar();
      const inField = inWalls.mul(step(0, p.y)).toVar();

      // 段階 3 以上: ボールの密度の勾配に沿ってグリッドを歪める。
      // 条件は uniform だけで決まるので、分岐の中でテクスチャを読んでよい
      const q = p.toVar();
      const densWarp = float(0).toVar();
      If(u.tier.greaterThan(WARP_TIER_START), () => {
        const warpAmt = smoothstep(WARP_TIER_START, WARP_TIER_FULL, u.tier).mul(0.35);
        const fuv = vec2(p.x.div(FIELD_W), p.y.div(FIELD_H)).clamp(0, 1);
        const ex = 1 / DENSITY_W;
        const ey = 1 / DENSITY_H;
        const dxs = texture(tex, fuv.add(vec2(ex, 0))).r.sub(texture(tex, fuv.sub(vec2(ex, 0))).r);
        const dys = texture(tex, fuv.add(vec2(0, ey))).r.sub(texture(tex, fuv.sub(vec2(0, ey))).r);
        const dens = texture(tex, fuv).r;
        q.assign(p.add(vec2(dxs, dys).mul(warpAmt.mul(-2.2)).mul(inField)));
        densWarp.assign(dens.mul(warpAmt));
      });

      // グリッド
      const g = q.div(GRID);
      // fwidth は分岐の外で求める（微分は全画素がそろって実行する場所でしか使えない）
      const fw = fwidth(g).max(vec2(1e-4, 1e-4)).toVar();
      const f = abs(fract(g.sub(0.5)).sub(0.5)).div(fw);
      const fMin = min(f.x, f.y).toVar();

      const hueT = u.hue.div(6.28318).add(p.y.mul(0.012)).add(0.7);
      const gridLevel = this.gridLevel.add(densWarp.mul(LOOK.background.gridDensity));
      const outside = mix(float(0.35), float(1), inWalls);

      // 下地のグラデーション
      const yN = p.y.div(FIELD_H).clamp(0, 1);
      const base = mix(vec3(0.012, 0.008, 0.03), vec3(0.03, 0.012, 0.06), yN).toVar();
      // 色の上乗せが 0 の間は、足しても値が変わらないので計算しない
      If(this.tint.notEqual(0), () => {
        base.addAssign(neon(hueT.add(0.3)).mul(this.tint));
      });
      // 奈落の暗がりは、壁の外も含めた画面の横幅いっぱいに、フィールドの下端より下まで続ける
      const pit = smoothstep(PIT_TOP, 0, p.y);
      const col = base.mul(float(1).sub(pit.mul(0.6))).toVar();
      // 線から離れた画素では線の重みがちょうど 0 で、足しても値が変わらないので計算しない。
      // 太い線（g が 4 の倍数）は細い線（g が整数）と重なるので、太い線までの距離は細い線までの距離以上で fm ≥ f。
      // f32 の丸めの差は |g| < 64 なら 4e-6 / fw 以下（fw ≥ 1e-4 なので 0.04 以下）。
      // よって fMin ≥ 2 の画素では fm > 1 で、どちらの線の重みも 0 になる
      If(fMin.lessThan(2), () => {
        const line = float(1).sub(min(fMin, 1));
        const fm = abs(fract(g.div(4).sub(0.5)).sub(0.5)).div(fw.div(4));
        const major = float(1).sub(min(min(fm.x, fm.y), 1));
        const lineW = line.mul(0.55).add(major.mul(0.45)).toVar();
        If(lineW.greaterThan(0), () => {
          col.addAssign(neon(hueT).mul(lineW).mul(gridLevel).mul(outside));
        });
      });

      // 壁と天井。壁は当たった場所からゴムのように波打つ。光が見える帯（CPU で求める）の画素だけで計算する。
      // 壁の色の色相は f32 で割って fract するので、CPU で求めると大きな hue で GPU の値とずれる。帯の中で GPU が求める
      const nearL = abs(p.x).lessThan(this.glowReachLeft);
      const nearR = abs(p.x.sub(FIELD_W)).lessThan(this.glowReachRight);
      const nearTop = abs(p.y.sub(FIELD_H)).lessThan(WALL_GLOW_BAND);
      If(nearL.or(nearR).or(nearTop), () => {
        const wallCol = neon(u.hue.div(6.28318).add(0.52)).mul(LOOK.background.wall);
        const dispL = float(0).toVar();
        const dispR = float(0).toVar();
        If(p.x.lessThan(this.waveLeft).or(p.x.greaterThan(this.waveRight)), () => {
          // 反対側の壁の揺れを省ける間は、画素に近い側の壁に当たった記録だけを足す（向き × side ≤ 0 の記録）
          const side = select(p.x.lessThan(FIELD_W / 2), float(1), float(-1)).mul(this.nearSideOnly);
          Loop(WALL_HIT_SLOTS, ({ i }) => {
            const h = u.wallHits.element(i);
            If(h.z.mul(side).lessThanEqual(0), () => {
              const age = u.time.sub(h.y);
              const dy = abs(p.y.sub(h.x));
              const wave = exp(age.mul(-WALL_WAVE.decay))
                .mul(sin(age.mul(WALL_WAVE.freq).sub(dy.mul(WALL_WAVE.spatial))))
                .mul(exp(dy.mul(-WALL_WAVE.spread)))
                .mul(h.w)
                .mul(step(0, age));
              dispL.addAssign(wave.mul(step(h.z, 0)));
              dispR.addAssign(wave.mul(step(0, h.z)));
            });
          });
        });
        // 左右の壁と天井を 1 本につながった枠として扱い、枠までの距離で光らせる。
        // 壁は画面の下の外まで伸ばすので、角でも下端でも光が途切れない
        const above = max(p.y.sub(FIELD_H), 0);
        const dl = vec2(p.x.sub(dispL.mul(WALL_WAVE.amp)), above).length();
        const dr = vec2(p.x.sub(float(FIELD_W).add(dispR.mul(WALL_WAVE.amp))), above).length();
        const beside = max(max(p.x.negate(), p.x.sub(FIELD_W)), 0);
        const dc = vec2(beside, p.y.sub(FIELD_H)).length();
        const wallD = min(min(dl, dr), dc);
        const G = WALL_GLOW;
        col.addAssign(wallCol.mul(exp(wallD.mul(-G.sharp)).mul(G.sharpGain).add(exp(wallD.mul(-G.soft)).mul(G.softGain))));
      });

      // 危険ライン（エンドレスのみ）。脈動は 1 秒に 1 回程度のゆっくりしたものにする。
      // ラインの光が見える距離（CPU で求める。エンドレスでなければ負）より内側の画素だけで計算する
      const dd = abs(p.y.sub(DANGER_Y));
      If(dd.lessThan(this.dangerBand), () => {
        const D = DANGER_LINE;
        const dash = step(0.45, fract(p.x.mul(1.6).sub(u.time.mul(0.4))));
        const dangerPulse = sin(u.time.mul(6.28318 * 0.9)).mul(0.5).add(0.5);
        const dangerLevel = float(D.base).add(u.danger.mul(u.danger).mul(dangerPulse.mul(D.pulseGain).add(D.pulseBase)));
        col.addAssign(
          vec3(...D.color)
            .mul(exp(dd.mul(-D.sharp)).mul(dash).add(exp(dd.mul(-D.soft)).mul(u.danger.mul(D.softGain))))
            .mul(dangerLevel)
            .mul(u.endless)
            .mul(inField),
        );
      });

      // 衝撃波。見えている間だけ、前線の近く（CPU で求める）の画素で計算する
      If(this.shockBand.greaterThan(0), () => {
        const S = SHOCK_RING;
        const age = u.time.sub(u.shock.z);
        const front = age.mul(u.shock.w);
        const sr = p.sub(u.shock.xy).length();
        If(abs(sr.sub(front)).lessThan(this.shockBand), () => {
          const ring = exp(sr.sub(front).mul(sr.sub(front)).mul(-S.width)).mul(this.shockFade).mul(step(0, age));
          col.addAssign(vec3(...S.color).mul(ring).mul(LOOK.background.shock));
        });
      });

      return max(col, vec3(0, 0, 0));
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    material.depthWrite = false;
    material.depthTest = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.update();
  }

  /** カメラの映す範囲より少し広く覆う（揺れで端が見えないように） */
  cover(left: number, right: number, bottom: number, top: number): void {
    const m = 3;
    this.mesh.position.set((left + right) / 2, (bottom + top) / 2, -1);
    this.mesh.scale.set(right - left + m * 2, top - bottom + m * 2, 1);
  }

  /** ボールの位置を密度に足す。前のフレームと混ぜて滑らかにする。1 フレームに 1 回呼ぶ */
  updateDensity(xs: ArrayLike<number>, ys: ArrayLike<number>, count: number): void {
    this.density.accumulate(xs, ys, count);
  }

  /** 密度の記録を消す */
  resetDensity(): void {
    this.density.reset();
  }

  /**
   * 描画の前に毎フレーム呼ぶ。u.time・u.tier・u.wallHits をそのフレームの値に書き終え、
   * u.danger・u.endless・u.shock も同じフレームの値にしておく。updateDensity も済ませたあとに呼ぶ。
   * 壁の揺れ・光、危険ライン、衝撃波を計算する範囲を決め、密度テクスチャを必要なときだけ送る。
   */
  update(): void {
    const u = this.u;
    const b = wallWaveBounds(u.wallHits.array as WallHit[], u.time.value, this.bounds);
    this.waveLeft.value = b.left;
    this.waveRight.value = b.right;
    this.glowReachLeft.value = b.shiftLeft + WALL_GLOW_BAND;
    this.glowReachRight.value = b.shiftRight + WALL_GLOW_BAND;
    this.nearSideOnly.value = farWallNegligible(b) ? 1 : 0;
    this.dangerBand.value = dangerReach(u.danger.value, u.endless.value);
    this.shockBand.value = shockReach(u.time.value, u.shock.value.z);
    const L = LOOK.background;
    const beatOn = smoothstepOf(0.5, 1.2, u.tier.value);
    this.gridLevel.value = L.grid + u.beat.value * L.gridBeat * beatOn + u.intensity.value * L.gridIntensity + u.glow.value * L.gridGlow;
    this.tint.value = u.glow.value * 0.12 + u.intensity.value * 0.05;
    this.shockFade.value = Math.exp(-SHOCK_RING.decay * shockAge(u.time.value, u.shock.value.z));
    if (this.density.takeUpload(isWarpActive(u.tier.value))) this.densityTex.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.densityTex.dispose();
  }
}
