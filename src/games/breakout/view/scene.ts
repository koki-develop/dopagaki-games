import * as THREE from 'three/webgpu';
import type { CameraOffset } from '../../../juice/camera.ts';
import type { PostChain } from '../../../engine/post.ts';
import { FIELD_H, FIELD_W, PADDLE_Y } from '../config.ts';
import type { FrameTime } from '../frame-time.ts';
import { DEBRIS_CAPACITY } from '../fx/debris.ts';
import { WALL_HIT_SLOTS } from '../fx/fx-state.ts';
import type { FxState } from '../fx/fx-state.ts';
import type { Sim } from '../sim/sim.ts';
import { BackgroundView } from './background.ts';
import { BallsView, createBallLook, FallenBallsView } from './balls.ts';
import type { BallLook } from './balls.ts';
import { BlocksView } from './blocks.ts';
import { DebrisView } from './debris.ts';
import { FlashView } from './flash.ts';
import type { Layout } from './layout.ts';
import { PaddleView } from './paddle.ts';
import { ParticlesView } from './particles.ts';
import { LOOK } from './look.ts';
import { createViewUniforms } from './uniforms.ts';
import { VignetteView } from './vignette.ts';
import type { ViewUniforms } from './uniforms.ts';

const PARTICLE_CAPACITY = 6000;
/**
 * 奈落に落ちたボール。最も浅い角度（水平から 15 度、最低の速さ）で落ちたボールは、フィールドの下端から 10 下まで
 * 進むのに 4.3 秒ほどかかるので、1 秒あたり約 470 個までなら、そこまでに上書きされない
 */
const FALLEN_BALL_CAPACITY = 2048;

/** bloom の強さを受け取る先。本番では PostChain */
export type BloomTarget = Pick<PostChain, 'setBloom'>;

/** 描く世界。sim と、sim の時刻を present の時間軸（u.time）へ直すために足す値 */
export type SceneSource = {
  readonly sim: Sim;
  readonly presentOffset: number;
};

/**
 * ブロック崩しの描画一式。orthographic カメラで、フィールドを 2.5D の平面として描く。
 * 描画順: 背景 → 破片 → ブロック → パーティクル → ボール（奈落に落ちたボールも） → パドル → ビネット → フラッシュ
 *
 * 1 フレームの書き出しは `apply(fx, ft)`（uniform・bloom・パドルの変形）→ `sync(...)`（インスタンスとカメラ）の順。
 * uniform を書くのは apply だけで、毎フレーム FxState の全部の値を写すので、前のプレイの値は残りようがない。
 */
export class BreakoutView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, FIELD_W, FIELD_H, 0, -10, 10);
  readonly uniforms: ViewUniforms = createViewUniforms();
  readonly background: BackgroundView;
  readonly blocks: BlocksView;
  readonly ballLook: BallLook = createBallLook();
  readonly balls: BallsView;
  readonly fallenBalls: FallenBallsView;
  readonly paddle: PaddleView;
  readonly particles: ParticlesView;
  readonly debris: DebrisView;
  readonly flash: FlashView;
  readonly vignette: VignetteView;
  private post: BloomTarget | null = null;
  private bloomStrength: number = LOOK.bloom.base;
  private bloomRadius: number = LOOK.bloom.radius;
  private layout: Layout | null = null;

  constructor() {
    const u = this.uniforms;
    this.background = new BackgroundView(u);
    this.debris = new DebrisView(u, DEBRIS_CAPACITY);
    this.blocks = new BlocksView(u);
    this.particles = new ParticlesView(u, PARTICLE_CAPACITY);
    this.balls = new BallsView(u, this.ballLook);
    this.fallenBalls = new FallenBallsView(u, this.ballLook, FALLEN_BALL_CAPACITY);
    this.paddle = new PaddleView(u);
    this.flash = new FlashView(u);
    this.vignette = new VignetteView(u);
    for (const m of [this.background, this.debris, this.blocks, this.particles, this.fallenBalls, this.balls, this.paddle, this.vignette, this.flash]) this.scene.add(m.mesh);
    this.camera.position.set(FIELD_W / 2, FIELD_H / 2, 5);
  }

  setLayout(l: Layout): void {
    this.layout = l;
  }

  /** bloom を掛ける先（初回と、GPU を失って作り直したとき）。今の bloom の強さをそのまま渡す */
  setPost(post: BloomTarget | null): void {
    this.post = post;
    post?.setBloom(this.bloomStrength, this.bloomRadius, LOOK.bloom.threshold);
  }

  /** 品質設定によるパーティクルと破片の予算（0〜1） */
  setParticleBudget(budget: number): void {
    this.particles.setBudget(budget);
    this.debris.setBudget(budget);
  }

  /** プレイが切り替わった。飛んでいる粒と破片、奈落に落ちたボール、ボールの密度の記録を消す */
  clearTransient(): void {
    this.particles.clear();
    this.debris.clear();
    this.fallenBalls.clear();
    this.background.resetDensity();
  }

  /** レンダラーを作り直した。ブロックのインスタンスを次の sync で書き出し直す */
  invalidateGpu(): void {
    this.blocks.invalidate();
  }

  /**
   * 演出の状態を uniform・bloom・パドルの変形へ写す。uniform を書くのはここだけ。
   * u.time は ft.present（粒や破片の発生時刻、衝撃波や壁の揺れの開始時刻と同じ時間軸）。
   */
  apply(fx: FxState, ft: FrameTime): void {
    const u = this.uniforms;
    u.time.value = ft.present;
    u.beat.value = fx.beat;
    u.intensity.value = fx.intensity;
    u.tier.value = fx.tier;
    u.hue.value = fx.hue;
    u.glow.value = fx.glow;
    u.danger.value = fx.danger;
    u.endless.value = fx.endless ? 1 : 0;
    u.flash.value = fx.flash;
    u.inhale.value = fx.inhale;
    u.vignette.value = fx.vignette;
    u.shock.value.set(fx.shockX, fx.shockY, fx.shockStart, fx.shockSpeed);
    u.focus.value.set(fx.focusX, fx.focusY);
    const hits = u.wallHits.array as THREE.Vector4[];
    const w = fx.wallHits;
    for (let i = 0; i < WALL_HIT_SLOTS; i++) hits[i].set(w[i * 4], w[i * 4 + 1], w[i * 4 + 2], w[i * 4 + 3]);
    this.paddle.squash.value.set(fx.paddleSquashX, fx.paddleSquashY);
    this.paddle.flash.value = fx.paddleFlash;
    if (fx.bloomStrength !== this.bloomStrength || fx.bloomRadius !== this.bloomRadius) {
      this.bloomStrength = fx.bloomStrength;
      this.bloomRadius = fx.bloomRadius;
      this.post?.setBloom(fx.bloomStrength, fx.bloomRadius, LOOK.bloom.threshold);
    }
  }

  /**
   * 世界の状態をインスタンスデータへ書き出し、カメラを動かす。apply の後に毎フレーム呼ぶ。
   * @param alpha 固定ステップ間の補間係数
   * @param paddleX パドルを描く x（入力をその場で反映した位置）
   * @param worldAdvanced このフレームで世界の時間が進んだか。進んだときだけボールの密度を積む
   */
  sync(src: SceneSource, alpha: number, paddleX: number, cam: CameraOffset, worldAdvanced: boolean): void {
    const sim = src.sim;
    const cfg = sim.config;
    if (worldAdvanced) this.background.updateDensity(sim.balls.x, sim.balls.y, sim.ballCount);
    this.background.update();
    this.vignette.update();
    this.flash.update();
    this.blocks.update(sim.blocks, src.presentOffset);
    const attached = sim.attached && sim.phase === 'playing';
    this.balls.update(sim.balls, alpha, sim.ballsMoving, attached ? paddleX : Number.NaN, sim.attachedBallY);
    this.ballLook.stretch.value = 0.08 * (sim.speed / cfg.ball.speedStart);
    // 50 個までは 1、上限（500 個）で約 0.45
    this.ballLook.brightness.value = 1 / Math.sqrt(1 + Math.max(0, sim.ballCount - 50) / 115);
    this.fallenBalls.flush();
    this.particles.flush();
    this.debris.flush();

    const p = this.paddle;
    p.x.value = paddleX;
    p.y.value = PADDLE_Y;
    p.width.value = cfg.paddle.width;
    p.height.value = cfg.paddle.height;

    const l = this.layout;
    if (!l) return;
    // ズームはフィールドの中心を基準にする
    const cx = FIELD_W / 2;
    const cy = FIELD_H / 2;
    const z = cam.zoom;
    const c = this.camera;
    c.left = (l.left - cx) / z;
    c.right = (l.right - cx) / z;
    c.bottom = (l.bottom - cy) / z;
    c.top = (l.top - cy) / z;
    c.position.set(cx + cam.x, cy + cam.y, 5);
    c.rotation.set(0, 0, cam.rotation);
    c.updateProjectionMatrix();
    // 背景は揺れや引きで端が見えないよう、カメラに付いていく
    const hw = (l.right - l.left) / 2 / z;
    const hh = (l.top - l.bottom) / 2 / z;
    const bx = cx + cam.x + ((l.left + l.right) / 2 - cx) / z;
    const by = cy + cam.y + ((l.bottom + l.top) / 2 - cy) / z;
    this.background.cover(bx - hw - 1, bx + hw + 1, by - hh - 1, by + hh + 1);
    this.flash.cover(bx - hw - 1, bx + hw + 1, by - hh - 1, by + hh + 1);
    this.vignette.cover(bx - hw - 1, bx + hw + 1, by - hh - 1, by + hh + 1);
  }

  dispose(): void {
    this.background.dispose();
    this.blocks.dispose();
    this.balls.dispose();
    this.fallenBalls.dispose();
    this.paddle.dispose();
    this.particles.dispose();
    this.debris.dispose();
    this.flash.dispose();
    this.vignette.dispose();
  }
}
