/** 割れたブロックの破片 1 個の発生条件。描画側は値を書き写すだけなので、演出側で使い回してよい */
export type DebrisSpec = {
  /** 重心（回転の中心）のワールド座標と速度（u/s） */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 回る速さ（ラジアン / 秒） */
  spin: number;
  /** 寿命（秒） */
  life: number;
  /** 縁の色（割れたブロックの縁と同じ） */
  r: number;
  g: number;
  b: number;
  /**
   * 頂点（重心基準、反時計回り）。j 番目は (verts[2j], verts[2j + 1])。
   * 三角形は 4 つ目の頂点に 3 つ目と同じ点を入れる
   */
  readonly verts: Float64Array;
};
