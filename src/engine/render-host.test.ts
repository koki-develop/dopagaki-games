import { describe, expect, test } from 'bun:test';
import type * as THREE from 'three/webgpu';
import { RenderHost } from './render-host.ts';

type LostInfo = { api: string; message: string };

/** RenderHost が使う WebGPURenderer の一部の代役 */
class FakeRenderer {
  readonly domElement = { style: {} as Record<string, string>, removed: false, remove() { this.removed = true; } };
  readonly backend = { isWebGPUBackend: true };
  readonly lighting = { enabled: true };
  toneMapping = 0;
  toneMappingExposure = 1;
  /** three.js の既定の処理が受け取った知らせ（既定の処理は描画を止める印を付ける） */
  readonly defaultLost: LostInfo[] = [];
  onDeviceLost: (info: LostInfo) => void = (info) => void this.defaultLost.push(info);
  initError: Error | null = null;
  disposeCalls = 0;
  buffers: [number, number, number][] = [];
  loop: ((t?: number) => void) | null = null;
  setClearColor(): void {}
  async init(): Promise<void> {
    if (this.initError) throw this.initError;
  }
  setDrawingBufferSize(w: number, h: number, r: number): void {
    this.buffers.push([w, h, r]);
  }
  async setAnimationLoop(cb: ((t?: number) => void) | null): Promise<void> {
    this.loop = cb;
  }
  async dispose(): Promise<void> {
    this.disposeCalls++;
    // init() に失敗したレンダラーは、dispose() の中で init() の失敗をもう一度投げる
    if (this.initError) throw this.initError;
  }
}

async function create(r = new FakeRenderer()) {
  const lost: number[] = [];
  const resized: number[] = [];
  const host = await RenderHost.create({
    exposure: 1,
    clearColor: 0,
    forceWebGL: false,
    onLost: () => lost.push(1),
    onResize: () => resized.push(1),
    createRenderer: () => r as unknown as THREE.WebGPURenderer,
  });
  return { host, r, lost, resized };
}

describe('RenderHost', () => {
  test('GPU を失ったら three.js の既定の処理にも知らせ、onLost は 1 回だけ呼ぶ', async () => {
    const { host, r, lost } = await create();
    const info = { api: 'WebGPU', message: 'gone' };
    r.onDeviceLost(info);
    r.onDeviceLost(info);
    expect(r.defaultLost).toEqual([info, info]);
    expect(lost).toEqual([1]);
    expect(host.lost).toBe(true);
  });

  test('捨てたあとに GPU を失っても onLost は呼ばない', async () => {
    const { host, r, lost } = await create();
    host.dispose();
    r.onDeviceLost({ api: 'WebGPU', message: 'destroyed' });
    expect(lost).toEqual([]);
  });

  test('初期化に失敗したら投げる。初期化していないレンダラーの dispose() は呼ばない', async () => {
    const r = new FakeRenderer();
    r.initError = new Error('no adapter');
    await expect(create(r)).rejects.toThrow('no adapter');
    expect(r.disposeCalls).toBe(0);
  });

  test('大きさと pixelRatio の上限を 1 つの経路で反映し、変わらなければ何もしない', async () => {
    const { host, r, resized } = await create();
    host.setSize(390, 844);
    host.setSize(390, 844);
    host.setPixelRatioCap(1);
    host.setSize(0, -5);
    // window のない環境では devicePixelRatio を 1 とみなす
    expect(r.buffers).toEqual([
      [390, 844, 1],
      [1, 1, 1],
    ]);
    expect(resized).toHaveLength(2);
  });

  test('dispose() はループを外し、レンダラーを捨て、canvas を取り除く。何度呼んでもよい', async () => {
    const { host, r } = await create();
    host.setAnimationLoop(() => undefined);
    expect(r.loop).not.toBeNull();
    host.dispose();
    host.dispose();
    expect(r.loop).toBeNull();
    expect(r.disposeCalls).toBe(1);
    expect(r.domElement.removed).toBe(true);
  });
});
