import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import { createWallHits, PRESENT_LONG_AGO, SHOCK_SPEED_IDLE, WALL_HIT_SLOTS } from '../fx/fx-state.ts';

/**
 * 全シェーダーで共有する uniform。値を書くのは BreakoutView.apply だけで、演出の状態（FxState）を毎フレームそのまま写す。
 * 時間は present の時間軸（FrameTime.present）なので、世界が止まればアニメーションも止まる。
 * 作ったときの値は、何も起きていない状態（衝撃波や壁の揺れの開始時刻が十分な過去）にしておく。
 */
export function createViewUniforms() {
  const hits = createWallHits();
  return {
    /** present の時間軸の時刻（秒） */
    time: uniform(0),
    /** ビートの直後に 1 になって減衰する値 */
    beat: uniform(0),
    /** 0〜1 の演出の強さ（破壊ペースと chain から） */
    intensity: uniform(0),
    /** ボール数の段階を滑らかにした値（0〜4） */
    tier: uniform(0),
    /** 色相のずれ（ラジアン） */
    hue: uniform(0),
    /** 背景の明るさの上乗せ（終盤の高まりなど） */
    glow: uniform(0),
    /** エンドレスで、ブロックが危険ラインにどれだけ迫っているか（0〜1） */
    danger: uniform(0),
    /** エンドレスかどうか（危険ラインを描く） */
    endless: uniform(0),
    /** 画面全体のフラッシュの強さ */
    flash: uniform(0),
    /** 吸い込みの強さ（0〜1）。ボールと粒を focus へ引き寄せる */
    inhale: uniform(0),
    /** 画面の縁から focus へ向かって暗く絞り込む強さ（0〜1） */
    vignette: uniform(0),
    /** 衝撃波: 中心 x, y、開始時刻、速さ */
    shock: uniform(new THREE.Vector4(0, 0, PRESENT_LONG_AGO, SHOCK_SPEED_IDLE)),
    /** ステージクリアの溜めで、すべてが吸い込まれていく点 */
    focus: uniform(new THREE.Vector2(0, 0)),
    /** 壁に当たった位置と時刻: (y, 開始時刻, 向き -1 左 / 1 右, 強さ) */
    wallHits: uniformArray<'vec4'>(
      Array.from({ length: WALL_HIT_SLOTS }, (_, i) => new THREE.Vector4(hits[i * 4], hits[i * 4 + 1], hits[i * 4 + 2], hits[i * 4 + 3])),
      'vec4',
    ),
  };
}

export type ViewUniforms = ReturnType<typeof createViewUniforms>;
