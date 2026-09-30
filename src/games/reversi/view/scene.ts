import * as THREE from 'three/webgpu';
import { ParticlesView } from '../../../engine/particles.ts';
import type { PostChain } from '../../../engine/post.ts';
import { ScreenFlash } from '../../../engine/screen-fx.ts';
import type { CameraOffset } from '../../../juice/camera.ts';
import type { FrameTime } from '../../../juice/frame-time.ts';
import type { DiscField } from '../fx/discs.ts';
import { RIPPLE, SHOCKWAVE } from '../config.ts';
import type { FxState } from '../fx/fx-state.ts';
import type { Layout } from '../geometry.ts';
import { BOARD_SIZE } from '../rules/position.ts';
import { BackgroundView } from './background.ts';
import { BoardView } from './board.ts';
import { DiscsView } from './discs.ts';
import { ImpactView } from './impact.ts';
import { LOOK } from './look.ts';
import { createViewUniforms } from './uniforms.ts';
import type { ViewUniforms } from './uniforms.ts';

const PARTICLE_CAPACITY = 5000;
const HALF = BOARD_SIZE / 2;

/** bloom の強さと RGB のずれを受け取る先。本番では PostChain */
export type PostTarget = Pick<PostChain, 'setBloom' | 'setAberration'>;

/**
 * リバーシの描画一式。orthographic カメラで、盤を真上から描く。
 * 描画順: 背景 → 盤 → 石 → 粒 → 集中線 → フラッシュ
 *
 * 1 フレームの書き出しは `apply(fx, ft)`（uniform・bloom）→ `sync(discs, cam)`（石のインスタンスとカメラ）の順。
 * uniform を書くのは apply だけで、毎フレーム FxState の全部の値を写すので、前のプレイの値は残りようがない。
 */
export class ReversiView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, BOARD_SIZE, BOARD_SIZE, 0, -10, 10);
  readonly uniforms: ViewUniforms = createViewUniforms();
  readonly background: BackgroundView;
  readonly board: BoardView;
  readonly discs: DiscsView;
  readonly particles: ParticlesView;
  readonly impact: ImpactView;
  readonly flash: ScreenFlash;
  private post: PostTarget | null = null;
  private bloomStrength: number = LOOK.bloom.base;
  private layout: Layout | null = null;

  constructor() {
    const u = this.uniforms;
    this.background = new BackgroundView(u);
    this.board = new BoardView(u);
    this.discs = new DiscsView(u);
    this.particles = new ParticlesView({ capacity: PARTICLE_CAPACITY, time: u.time, brightness: LOOK.particles, renderOrder: 30 });
    this.impact = new ImpactView(u);
    this.flash = new ScreenFlash({ level: u.flash, renderOrder: 100 });
    for (const m of [this.background, this.board, this.discs, this.particles, this.impact, this.flash]) this.scene.add(m.mesh);
    this.camera.position.set(HALF, HALF, 5);
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

  /** レンダラーを作り直した。石のインスタンスを次の sync で送り直す */
  invalidateGpu(): void {
    this.discs.invalidate();
  }

  /**
   * 演出の状態を uniform・bloom・RGB のずれへ写す。uniform を書くのはここだけ。u.time は ft.present、u.real は ft.real。
   * jolt は衝撃に伴う画面上の効果の倍率（CameraMotion.jolt）で、止めた石の震えと RGB のずれに掛ける
   */
  apply(fx: FxState, ft: FrameTime, jolt: number): void {
    const u = this.uniforms;
    u.time.value = ft.present;
    u.real.value = ft.real;
    u.fever.value = fx.fever;
    u.hit.value.set(fx.hitX, fx.hitY, fx.hitShake * jolt);
    u.impact.value.set(fx.impactX, fx.impactY, fx.impactAt, fx.impactStrength);
    this.post?.setAberration(fx.aberration * jolt, fx.aberrationAngle);
    u.beat.value = fx.beat;
    u.intensity.value = fx.intensity;
    u.hue.value = fx.hue;
    u.glow.value = fx.glow;
    u.flash.value = fx.flash;
    u.rays.value = fx.rays;
    u.rainbow.value = fx.rainbow;
    u.rainbowTurns.value = fx.rainbowTurns;
    u.turnTint.value = fx.turnTint;
    u.dread.value = fx.dread;
    u.boardAppear.value = fx.boardAppear;
    copySlots(u.ripples.array as THREE.Vector4[], fx.ripples, RIPPLE.slots);
    copySlots(u.shockwaves.array as THREE.Vector4[], fx.shockwaves, SHOCKWAVE.slots);
    u.cursor.value.set(fx.cursorX, fx.cursorY, fx.cursor);
    u.hover.value.set(fx.hoverX, fx.hoverY, fx.hover, fx.hoverLegal);
    u.lastMove.value.set(fx.lastX, fx.lastY, fx.lastAt);
    u.markerHue.value = fx.markerHue;
    if (fx.bloomStrength !== this.bloomStrength) {
      this.bloomStrength = fx.bloomStrength;
      this.post?.setBloom(fx.bloomStrength, LOOK.bloom.radius, LOOK.bloom.threshold);
    }
  }

  /** 石のインスタンスを書き出し、カメラを動かす。apply の後に毎フレーム呼ぶ */
  sync(discs: DiscField, cam: CameraOffset): void {
    this.discs.update(discs);
    this.particles.flush();
    this.flash.update();

    const l = this.layout;
    if (!l) return;
    // ズームは盤の中心を基準にする
    const z = cam.zoom;
    const c = this.camera;
    c.left = (l.left - HALF) / z;
    c.right = (l.right - HALF) / z;
    c.bottom = (l.bottom - HALF) / z;
    c.top = (l.top - HALF) / z;
    c.position.set(HALF + cam.x, HALF + cam.y, 5);
    c.rotation.set(0, 0, cam.rotation);
    c.updateProjectionMatrix();
    // 背景・集中線・フラッシュは、揺れや引きで端が見えないよう、カメラに付いていく
    const hw = (l.right - l.left) / 2 / z;
    const hh = (l.top - l.bottom) / 2 / z;
    const bx = HALF + cam.x + ((l.left + l.right) / 2 - HALF) / z;
    const by = HALF + cam.y + ((l.bottom + l.top) / 2 - HALF) / z;
    this.background.cover(bx - hw - 1, bx + hw + 1, by - hh - 1, by + hh + 1);
    this.flash.cover(bx - hw - 1, bx + hw + 1, by - hh - 1, by + hh + 1);
    this.impact.cover(bx - hw - 1, bx + hw + 1, by - hh - 1, by + hh + 1);
  }

  dispose(): void {
    this.background.dispose();
    this.board.dispose();
    this.discs.dispose();
    this.particles.dispose();
    this.impact.dispose();
    this.flash.dispose();
  }
}

/** 4 値ずつの記録 values を、vec4 の uniform の配列 out へ写す */
function copySlots(out: THREE.Vector4[], values: Float32Array, slots: number): void {
  for (let i = 0; i < slots; i++) out[i].set(values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3]);
}
