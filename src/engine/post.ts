import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { QualityLevel } from './quality.ts';
import type { RenderHost } from './render-host.ts';

/**
 * シーンを HalfFloat の描画先へ描き、bloom を足して画面へ出す RenderPipeline。
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
  private disposed = false;

  constructor(host: RenderHost, scene: THREE.Scene, camera: THREE.Camera) {
    this.host = host;
    this.scene = scene;
    this.camera = camera;
    this.pipeline = new THREE.RenderPipeline(host.renderer);
    this.scenePass = pass(scene, camera, { depthBuffer: false });
    const color = this.scenePass.getTextureNode('output');
    // 強さ・広がり・しきい値は、呼び出し側が setBloom() で毎フレーム決める
    this.bloomNode = bloom(color, 0, 0, 1);
    this.pipeline.outputNode = color.add(this.bloomNode);
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
