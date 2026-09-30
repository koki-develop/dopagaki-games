import * as THREE from 'three/webgpu';
import { cos, pass, sin, uniform, uv, vec2, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { QualityLevel } from './quality.ts';
import type { RenderHost } from './render-host.ts';

/** PostChain の作り方 */
export type PostOptions = {
  /** RGB のずれ（色の成分を少しずつずらす）を使うか。使わないゲームでは、そのための読み出しを省く */
  aberration?: boolean;
};

/**
 * シーンを HalfFloat の描画先へ描き、bloom を足して画面へ出す RenderPipeline。
 * aberration を使うなら、シーンの色の赤と青を逆向きにずらしてから bloom を足す。
 * シーンの描画先には深度バッファを付けない（RenderHost と同じく、描画順だけで重ねる）。
 * RenderHost を作り直したら、PostChain も新しい RenderHost で作り直す。
 */
export class PostChain {
  private readonly host: RenderHost;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly pipeline: THREE.RenderPipeline;
  private readonly scenePass: ReturnType<typeof pass>;
  private readonly bloomNode: ReturnType<typeof bloom>;
  /** RGB のずれの量（画面の幅に対する割合）と向き（ラジアン） */
  private readonly aberrationAmount = uniform(0);
  private readonly aberrationAngle = uniform(0);
  private disposed = false;

  constructor(host: RenderHost, scene: THREE.Scene, camera: THREE.Camera, options: PostOptions = {}) {
    this.host = host;
    this.scene = scene;
    this.camera = camera;
    this.pipeline = new THREE.RenderPipeline(host.renderer);
    this.scenePass = pass(scene, camera, { depthBuffer: false });
    const color = this.scenePass.getTextureNode('output');
    // 強さ・広がり・しきい値は、呼び出し側が setBloom() で毎フレーム決める
    this.bloomNode = bloom(color, 0, 0, 1);
    if (options.aberration) {
      // RGBShiftNode（three/addons）と同じ計算: 赤と青を逆向きにずらして読み、緑と不透明度はそのまま
      const at = color.uvNode ?? uv();
      const offset = vec2(cos(this.aberrationAngle), sin(this.aberrationAngle)).mul(this.aberrationAmount);
      const mid = color.sample(at);
      const shifted = vec4(color.sample(at.add(offset)).r, mid.g, color.sample(at.sub(offset)).b, mid.a);
      this.pipeline.outputNode = shifted.add(this.bloomNode);
    } else {
      this.pipeline.outputNode = color.add(this.bloomNode);
    }
  }

  /** RGB のずれ。aberration を使わない PostChain では何も起きない */
  setAberration(amount: number, angle: number): void {
    this.aberrationAmount.value = amount;
    this.aberrationAngle.value = angle;
  }

  /** 品質の段階のうち、bloom の解像度を反映する */
  setQuality(q: QualityLevel): void {
    this.bloomNode.setResolutionScale(q.bloomScale);
  }

  setBloom(strength: number, radius: number, threshold: number): void {
    this.bloomNode.strength.value = strength;
    this.bloomNode.radius.value = radius;
    this.bloomNode.threshold.value = threshold;
  }

  /**
   * 最初の描画でのコンパイル待ちをなくす。読み込み画面の裏で一度だけ呼ぶ。
   * シーンのパイプラインはシーンの描画先の形式で非同期にコンパイルし、
   * bloom と画面への出力のパイプラインは、1 フレーム描画して作る
   */
  async warmUp(): Promise<void> {
    await this.host.warmUp(this.scene, this.camera, this.scenePass.renderTarget);
    this.render();
  }

  render(): void {
    if (this.disposed || this.host.lost) return;
    this.pipeline.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pipeline.dispose();
    this.bloomNode.dispose();
    this.scenePass.dispose();
  }
}
