import type * as THREE from 'three/webgpu';
import { PostChain } from './post.ts';
import type { PostOptions } from './post.ts';
import type { DriverGraphics, GraphicsEvents } from './render-driver.ts';
import { RenderHost } from './render-host.ts';

/** RenderHost と PostChain の描画一式。bloom の強さと RGB のずれを外から変えられる */
type PostGraphics = DriverGraphics & Pick<PostChain, 'setBloom' | 'setAberration'>;

type PostGraphicsOptions = {
  /** canvas を先頭に置く要素 */
  container: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** トーンマッピングの露出 */
  exposure: number;
  /** 描画前に塗りつぶす色 */
  clearColor: number;
  events: GraphicsEvents;
  post?: PostOptions;
};

/**
 * 開発ビルドで、URL に `?backend=webgl` が付いているか。付いていれば WebGPU が使えても WebGL2 で描く（フォールバック経路の確認用）
 */
function forcedWebGL(): boolean {
  return Boolean(import.meta.env.DEV) && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('backend') === 'webgl';
}

/** RenderHost と PostChain を作り、container の先頭に canvas を置く */
export async function createPostGraphics(opts: PostGraphicsOptions): Promise<PostGraphics> {
  const host = await RenderHost.create({
    exposure: opts.exposure,
    clearColor: opts.clearColor,
    forceWebGL: forcedWebGL(),
    onLost: opts.events.onLost,
    onResize: opts.events.onResize,
  });
  opts.container.prepend(host.canvas);
  const post = new PostChain(host, opts.scene, opts.camera, opts.post);
  return {
    backend: host.backend,
    host,
    setSize: (w, h) => host.setSize(w, h),
    setQuality: (q) => {
      host.setPixelRatioCap(q.pixelRatio);
      post.setQuality(q);
    },
    setBloom: (strength, radius, threshold) => post.setBloom(strength, radius, threshold),
    setAberration: (amount, angle) => post.setAberration(amount, angle),
    warmUp: () => post.warmUp(),
    setAnimationLoop: (cb) => host.setAnimationLoop(cb),
    render: () => post.render(),
    dispose: () => {
      post.dispose();
      host.dispose();
    },
  };
}
