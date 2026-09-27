/** パーティクルの形。演出（CPU）とシェーダーの両方が使うので、three.js に依存しない場所に置く */
export const ParticleShape = {
  /** 速度の方向に伸びる火花 */
  Spark: 0,
  /** 柔らかい光の点 */
  Dot: 1,
  /** 広がる輪 */
  Ring: 2,
  /** 目標へ吸い込まれていく光の筋。進む向きに伸びる（lane3 の zw が目標） */
  Homing: 3,
} as const;
export type ParticleShape = (typeof ParticleShape)[keyof typeof ParticleShape];

/** パーティクル 1 個の発生条件。描画側は値を書き写すだけなので、演出側で 1 つのオブジェクトを使い回してよい */
export type ParticleSpec = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 寿命（秒） */
  life: number;
  /** 生まれたときと消えるときの大きさ */
  size0: number;
  size1: number;
  r: number;
  g: number;
  b: number;
  shape: ParticleShape;
  /** 下向きの加速度（u / 秒²） */
  gravity: number;
  /** 速度の減衰率（1 / 秒） */
  drag: number;
  /** Homing の目標。ほかの形では使わない */
  targetX: number;
  targetY: number;
};

/** 壊れたブロックの破片 1 個の発生条件。ParticleSpec と同じく、描画側は値を書き写すだけ */
export type DebrisSpec = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  g: number;
  b: number;
  size: number;
};
