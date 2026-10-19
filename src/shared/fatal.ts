/**
 * ゲームを続けられなくなった原因。画面に出す文言を選ぶのに使う。three.js を知らない層（画面の状態機械など）からも読む。
 * - init: 描画（WebGPU / WebGL2）を始められなかった
 * - load: ゲームに要るデータ（画像など）を読み込めなかった
 * - lost: GPU を失い、描画を作り直せなかった
 * - internal: ゲームの処理の途中で失敗した
 */
export type FatalCause = 'init' | 'load' | 'lost' | 'internal';

/** ゲームに要るデータを読み込めなかった。ゲーム本体を作る途中でこれを投げると、原因は load になる */
export class LoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LoadError';
  }
}

/** ゲーム本体を作れなかった例外の原因 */
export const startFailureCause = (e: unknown): FatalCause => (e instanceof LoadError ? 'load' : 'init');
