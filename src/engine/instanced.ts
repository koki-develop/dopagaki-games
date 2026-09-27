import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { instancedBufferAttribute } from 'three/tsl';
import { RingCursor } from './ring.ts';
import type { DirtySink } from './ring.ts';
import { UploadScheduler } from './upload-ranges.ts';


/**
 * インスタンスごとのデータを vec4 の並び（lanes 本）で持つバッファ。
 *
 * TSL の instancedBufferAttribute に InstancedInterleavedBuffer を直接渡す。
 * BufferAttribute を渡すと内部で通常の InterleavedBuffer に包まれてしまい、
 * WebGL2 バックエンドでインスタンスごとの読み出し（divisor）が設定されない。
 *
 * GPU へ送るのは、markDirty / markAllDirty で版を上げたあとの描画だけ（StaticDrawUsage）。
 * 送る範囲はここで管理し、全体の送り直しは実際に送られるまで部分的な範囲より優先する（UploadScheduler）。
 */
export class InstanceBuffer implements DirtySink {
  readonly capacity: number;
  readonly stride: number;
  readonly data: Float32Array;
  readonly buffer: THREE.InstancedInterleavedBuffer;
  readonly nodes: Node<'vec4'>[];
  private readonly uploads: UploadScheduler;

  constructor(capacity: number, lanes: number) {
    this.capacity = capacity;
    this.stride = lanes * 4;
    this.data = new Float32Array(capacity * this.stride);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, this.stride, 1);
    this.uploads = new UploadScheduler(this.buffer, this.data.length);
    this.nodes = [];
    for (let i = 0; i < lanes; i++) this.nodes.push(instancedBufferAttribute<'vec4'>(this.buffer, 'vec4', this.stride, i * 4));
  }

  /** 全体を送り直す。実際に送られるまでは、あとから markDirty した範囲より優先する */
  markAllDirty(): void {
    this.uploads.markAll();
  }

  /** インスタンス [first, first + count) だけを送り直す */
  markDirty(first: number, count: number): void {
    if (count <= 0) return;
    this.uploads.mark(first * this.stride, count * this.stride);
  }
}

/**
 * 発生時の条件だけを書き込み、古いものから上書きしていくインスタンスのリングバッファ（パーティクル、破片）。
 *
 * すべて 0 のインスタンスは描かれないように、シェーダーを作ること（`clear()` はデータ全体を 0 にする）。
 * 書いたインスタンスは `flush()` で送り直す指定に変え、描画数（`drawCount`）をメッシュへ反映する。
 */
export class InstanceRing {
  readonly buffer: InstanceBuffer;
  private readonly cursor: RingCursor;

  constructor(capacity: number, lanes: number) {
    this.buffer = new InstanceBuffer(capacity, lanes);
    this.cursor = new RingCursor(capacity, this.buffer);
  }

  get nodes(): Node<'vec4'>[] {
    return this.buffer.nodes;
  }

  get data(): Float32Array {
    return this.buffer.data;
  }

  get stride(): number {
    return this.buffer.stride;
  }

  get capacity(): number {
    return this.buffer.capacity;
  }

  /** 描画するインスタンス数。これまでに書いた一番後ろまで（2 以上） */
  get drawCount(): number {
    return this.cursor.drawCount;
  }

  /** 予算（0〜1）。実効容量を容量 × 予算にして、先頭へ戻る位置を早める */
  setBudget(budget: number): void {
    this.cursor.setBudget(budget);
  }

  /** 書き込む場所を 1 つ受け取り、そのインスタンスの data 上の先頭位置を返す */
  claim(): number {
    return this.cursor.claim() * this.buffer.stride;
  }

  /** 前回からの書き込みを、送り直す指定に変える（多くても 2 範囲） */
  flush(): void {
    this.cursor.flush();
  }

  /** すべて消す。データ全体を 0 にし、次の描画で全体を送る */
  clear(): void {
    this.buffer.data.fill(0);
    this.cursor.clear();
  }
}

/** 1 x 1 の四角形。インスタンスの形は頂点シェーダーで決める */
export const unitQuad = (): THREE.PlaneGeometry => new THREE.PlaneGeometry(1, 1);
