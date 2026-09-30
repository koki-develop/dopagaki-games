/**
 * ゲームを続けられなくなった原因。画面に出す文言を選ぶのに使う。three.js を知らない層（画面の状態機械など）からも読む。
 * - init: 描画（WebGPU / WebGL2）を始められなかった
 * - lost: GPU を失い、描画を作り直せなかった
 * - internal: ゲームの処理の途中で失敗した
 */
export type FatalCause = 'init' | 'lost' | 'internal';
