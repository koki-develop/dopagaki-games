import { uniform, uniformArray } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { PRESENT_LONG_AGO } from '../../../juice/frame-time.ts';
import { SHOCKWAVE } from '../config.ts';
import { createShockwaves, createSpots } from '../fx/fx-state.ts';
import { MAX_HANDS } from '../rules/round.ts';

/** 4 値ずつの記録を vec4 の uniform の配列にする */
const vec4Array = (values: Float32Array, slots: number) =>
  uniformArray<'vec4'>(
    Array.from({ length: slots }, (_, i) => new THREE.Vector4(values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3])),
    'vec4',
  );

/**
 * 全シェーダーで共有する uniform。値を書くのは BlackjackView.apply だけで、演出の状態（FxState）を毎フレームそのまま写す。
 * time は present の時間軸（FrameTime.present）なので、世界が止まればカードとチップの動きも止まる。
 * real はセッションの実時間で、ヒットストップの間も流れる背景・止めたカードの震え・集中線に使う。
 */
export function createViewUniforms() {
  return {
    /** present の時間軸の時刻（秒） */
    time: uniform(0),
    /** セッションの実時間（秒） */
    real: uniform(0),
    fever: uniform(0),
    beat: uniform(0),
    /** ヒットストップで止めたカードとチップの震えの強さ */
    hitShake: uniform(0),
    /** 集中線: 中心 x, y、始めた実時間、強さ */
    impact: uniform(new THREE.Vector4(0, 0, PRESENT_LONG_AGO, 0)),
    intensity: uniform(0),
    hue: uniform(0),
    glow: uniform(0),
    flash: uniform(0),
    rays: uniform(0),
    rainbow: uniform(0),
    rainbowTurns: uniform(0),
    dread: uniform(0),
    /** 溜めの絞り込み: 強さと、絞り込む先 */
    focus: uniform(0),
    focusPoint: uniform(new THREE.Vector2(0, 0)),
    /** 衝撃波: (x, y, 開始時刻, 速さ) を SHOCKWAVE.slots 件 */
    shockwaves: vec4Array(createShockwaves(), SHOCKWAVE.slots),
    tableAppear: uniform(1),
    /** 操作を待っている手の光: 中心 x, y、半分の大きさ w, h */
    activeRect: uniform(new THREE.Vector4(0, 0, 0, 0)),
    active: uniform(0),
    /** 賭けの丸: (x, y, 半径, 出す強さ) を MAX_HANDS 件 */
    spots: vec4Array(createSpots(), MAX_HANDS),
    /** 最後のラウンドか（0 / 1） */
    finalRound: uniform(0),
  };
}

export type ViewUniforms = ReturnType<typeof createViewUniforms>;
