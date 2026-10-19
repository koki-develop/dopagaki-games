import * as THREE from 'three/webgpu';
import { ParticlesView } from '../../../engine/particles.ts';
import type { PostChain } from '../../../engine/post.ts';
import { FocusVignette, ImpactLines, ScreenFlash } from '../../../engine/screen-fx.ts';
import type { CameraOffset } from '../../../juice/camera.ts';
import type { FrameTime } from '../../../juice/frame-time.ts';
import { SHOCKWAVE } from '../config.ts';
import type { CardField } from '../fx/cards.ts';
import type { ChipField } from '../fx/chips.ts';
import type { FxState } from '../fx/fx-state.ts';
import { TABLE_H, TABLE_W } from '../geometry.ts';
import type { Layout } from '../geometry.ts';
import { MAX_HANDS } from '../rules/round.ts';
import { BackgroundView } from './background.ts';
import { CardsView } from './cards.ts';
import { ChipsView } from './chips.ts';
import { LOOK } from './look.ts';
import { TableView } from './table.ts';
import { createViewUniforms } from './uniforms.ts';
import type { ViewUniforms } from './uniforms.ts';

const PARTICLE_CAPACITY = 5000;
const CX = TABLE_W / 2;
const CY = TABLE_H / 2;
/** 集中線の内側の端が、画面の外から寄ってくる距離（ワールド単位。カードの幅は 1.6） */
const IMPACT_REACH = { from: 13, to: 2.8 } as const;

/** bloom の強さと RGB のずれを受け取る先。本番では PostChain */
export type PostTarget = Pick<PostChain, 'setBloom' | 'setAberration'>;

/**
 * ブラックジャックの描画一式。orthographic カメラで、卓を真上から描く。
 * 描画順: 背景 → 卓 → カード → チップの影 → チップ → 粒 → 溜めの絞り込み → 集中線 → フラッシュ
 *
 * 1 フレームの書き出しは `apply(fx, ft)`（uniform・bloom）→ `sync(cards, chips, cam)`（インスタンスとカメラ）の順。
 * uniform を書くのは apply だけで、毎フレーム FxState の全部の値を写すので、前のプレイの値は残りようがない。
 */
export class BlackjackView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, TABLE_W, TABLE_H, 0, -10, 10);
  readonly uniforms: ViewUniforms = createViewUniforms();
  readonly background: BackgroundView;
  readonly table: TableView;
  readonly cards: CardsView;
  readonly chips: ChipsView;
  readonly particles: ParticlesView;
  readonly vignette: FocusVignette;
  readonly impact: ImpactLines;
  readonly flash: ScreenFlash;
  private post: PostTarget | null = null;
  private bloomStrength: number = LOOK.bloom.base;
  private layout: Layout | null = null;

  constructor() {
    const u = this.uniforms;
    this.background = new BackgroundView(u);
    this.table = new TableView(u);
    this.cards = new CardsView(u);
    this.chips = new ChipsView(u);
    this.particles = new ParticlesView({ capacity: PARTICLE_CAPACITY, time: u.time, brightness: LOOK.particles, renderOrder: 30 });
    this.vignette = new FocusVignette({ strength: u.focus, focus: u.focusPoint, outerRadius: 10, innerRadius: 2.2, band: 2.5, darkness: LOOK.focusDarkness, renderOrder: 80 });
    this.impact = new ImpactLines({ real: u.real, impact: u.impact, reachFrom: IMPACT_REACH.from, reachTo: IMPACT_REACH.to, brightness: LOOK.impactLines, renderOrder: 85 });
    this.flash = new ScreenFlash({ level: u.flash, renderOrder: 100 });
    for (const m of [this.background, this.table, this.cards, this.chips, this.particles, this.vignette, this.impact, this.flash]) this.scene.add(m.mesh);
    this.scene.add(this.chips.shadow);
    this.camera.position.set(CX, CY, 5);
  }

  /** 描き始める前に読み込むもの（カードの表の絵）を読み込む。読み込めなければ LoadError で失敗する */
  prepare(): Promise<void> {
    return this.cards.loadFaces();
  }

  setLayout(l: Layout): void {
    this.layout = l;
  }

  /** bloom と RGB のずれを掛ける先（初回と、GPU を失って作り直したとき）。今の bloom の強さをそのまま渡す */
  setPost(post: PostTarget | null): void {
    this.post = post;
    post?.setBloom(this.bloomStrength, LOOK.bloom.radius, LOOK.bloom.threshold);
    post?.setAberration(0, 0);
  }

  /** 品質設定による粒の予算（0〜1） */
  setParticleBudget(budget: number): void {
    this.particles.setBudget(budget);
  }

  /** プレイが切り替わった。飛んでいる粒を消す */
  clearTransient(): void {
    this.particles.clear();
  }

  /** レンダラーを作り直した。カードとチップのインスタンスを次の sync で送り直す */
  invalidateGpu(): void {
    this.cards.invalidate();
    this.chips.invalidate();
  }

  /**
   * 演出の状態を uniform・bloom・RGB のずれへ写す。uniform を書くのはここだけ。u.time は ft.present、u.real は ft.real。
   * jolt は衝撃に伴う画面上の効果の倍率（CameraMotion.jolt）で、止めたカードの震えと RGB のずれに掛ける
   */
  apply(fx: FxState, ft: FrameTime, jolt: number): void {
    const u = this.uniforms;
    u.time.value = ft.present;
    u.real.value = ft.real;
    u.fever.value = fx.fever;
    u.beat.value = fx.beat;
    u.hitShake.value = fx.hitShake * jolt;
    u.impact.value.set(fx.impactX, fx.impactY, fx.impactAt, fx.impactStrength);
    this.post?.setAberration(fx.aberration * jolt, fx.aberrationAngle);
    u.intensity.value = fx.intensity;
    u.hue.value = fx.hue;
    u.glow.value = fx.glow;
    u.flash.value = fx.flash;
    u.rays.value = fx.rays;
    u.rainbow.value = fx.rainbow;
    u.rainbowTurns.value = fx.rainbowTurns;
    u.dread.value = fx.dread;
    u.focus.value = fx.focus;
    u.focusPoint.value.set(fx.focusX, fx.focusY);
    copySlots(u.shockwaves.array as THREE.Vector4[], fx.shockwaves, SHOCKWAVE.slots);
    u.tableAppear.value = fx.tableAppear;
    u.activeRect.value.set(fx.activeX, fx.activeY, fx.activeHW, fx.activeHH);
    u.active.value = fx.active;
    copySlots(u.spots.array as THREE.Vector4[], fx.spots, MAX_HANDS);
    u.finalRound.value = fx.finalRound;
    if (fx.bloomStrength !== this.bloomStrength) {
      this.bloomStrength = fx.bloomStrength;
      this.post?.setBloom(fx.bloomStrength, LOOK.bloom.radius, LOOK.bloom.threshold);
    }
  }

  /** カードとチップのインスタンスを書き出し、カメラを動かす。apply の後に毎フレーム呼ぶ */
  sync(cards: CardField, chips: ChipField, cam: CameraOffset): void {
    this.cards.update(cards);
    this.chips.update(chips);
    this.particles.flush();
    this.flash.update();
    this.vignette.update();

    const l = this.layout;
    if (!l) return;
    // ズームは卓の中心を基準にする
    const z = cam.zoom;
    const c = this.camera;
    c.left = (l.left - CX) / z;
    c.right = (l.right - CX) / z;
    c.bottom = (l.bottom - CY) / z;
    c.top = (l.top - CY) / z;
    c.position.set(CX + cam.x, CY + cam.y, 5);
    c.rotation.set(0, 0, cam.rotation);
    c.updateProjectionMatrix();
    // 背景・絞り込み・集中線・フラッシュは、揺れや引きで端が見えないよう、カメラに付いていく
    const hw = (l.right - l.left) / 2 / z;
    const hh = (l.top - l.bottom) / 2 / z;
    const bx = CX + cam.x + ((l.left + l.right) / 2 - CX) / z;
    const by = CY + cam.y + ((l.bottom + l.top) / 2 - CY) / z;
    this.background.cover(bx - hw - 1, bx + hw + 1, by - hh - 1, by + hh + 1);
    this.vignette.cover(bx - hw - 1, bx + hw + 1, by - hh - 1, by + hh + 1);
    this.flash.cover(bx - hw - 1, bx + hw + 1, by - hh - 1, by + hh + 1);
    this.impact.cover(bx - hw - 1, bx + hw + 1, by - hh - 1, by + hh + 1);
  }

  dispose(): void {
    this.background.dispose();
    this.table.dispose();
    this.cards.dispose();
    this.chips.dispose();
    this.particles.dispose();
    this.vignette.dispose();
    this.impact.dispose();
    this.flash.dispose();
  }
}

/** 4 値ずつの記録 values を、vec4 の uniform の配列 out へ写す */
function copySlots(out: THREE.Vector4[], values: Float32Array, slots: number): void {
  for (let i = 0; i < slots; i++) out[i].set(values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3]);
}
