import { uniform, uniformArray } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { LONG_AGO } from '../fx/discs.ts';
import { RIPPLE, SHOCKWAVE } from '../config.ts';
import { createRipples, createShockwaves } from '../fx/fx-state.ts';

/** 4 値ずつの記録を vec4 の uniform の配列にする */
const vec4Array = (values: Float32Array, slots: number) =>
  uniformArray<'vec4'>(
    Array.from({ length: slots }, (_, i) => new THREE.Vector4(values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3])),
    'vec4',
  );

/**
 * 全シェーダーで共有する uniform。値を書くのは ReversiView.apply だけで、演出の状態（FxState）を毎フレームそのまま写す。
 * time は present の時間軸（FrameTime.present）なので、世界が止まれば石の動きも止まる。
 * real はセッションの実時間で、ヒットストップの間も流れる背景・盤の照り返し・止めた石の震え・集中線に使う。
 */
export function createViewUniforms() {
  return {
    /** present の時間軸の時刻（秒） */
    time: uniform(0),
    /** セッションの実時間（秒） */
    real: uniform(0),
    fever: uniform(0),
    /** ヒットストップで止めた石の震え: 中心 x, y、強さ */
    hit: uniform(new THREE.Vector3(0, 0, 0)),
    /** 集中線: 中心 x, y、始めた実時間、強さ */
    impact: uniform(new THREE.Vector4(0, 0, LONG_AGO, 0)),
    beat: uniform(0),
    intensity: uniform(0),
    hue: uniform(0),
    glow: uniform(0),
    flash: uniform(0),
    rays: uniform(0),
    rainbow: uniform(0),
    rainbowTurns: uniform(0),
    turnTint: uniform(1),
    dread: uniform(0),
    boardAppear: uniform(1),
    /** 波紋: (x, y, 開始時刻, 強さ) を RIPPLE.slots 件 */
    ripples: vec4Array(createRipples(), RIPPLE.slots),
    /** 衝撃波: (x, y, 開始時刻, 速さ) を SHOCKWAVE.slots 件 */
    shockwaves: vec4Array(createShockwaves(), SHOCKWAVE.slots),
    /** キーボードのカーソル: x, y, 強さ */
    cursor: uniform(new THREE.Vector3(0, 0, 0)),
    /** 押している・ホバーしているマス: x, y, 強さ, 打てるか（1 / 0） */
    hover: uniform(new THREE.Vector4(0, 0, 0, 0)),
    /** 最後に打ったマス: x, y, 打った時刻 */
    lastMove: uniform(new THREE.Vector3(0, 0, LONG_AGO)),
    /** 合法手の印と押している間の予告の色相（人の石の縁の色） */
    markerHue: uniform(0),
  };
}

export type ViewUniforms = ReturnType<typeof createViewUniforms>;
