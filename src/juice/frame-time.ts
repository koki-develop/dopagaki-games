/**
 * 1 フレームぶんの時刻。ゲームのセッションがフレームの初めに 1 回だけ作り、演出と描画へそのまま渡す。
 *
 * - real: セッションが始まってからの実時間（秒）。1 フレームの増分は上限つき。一時停止中は進まない
 * - world: プレイの世界時間（秒）。スローモーションで遅くなる
 * - present: シェーダーの u.time と同じ時間軸（秒）。セッションの間は戻らないので、前のプレイの粒の時刻と重ならない。
 *   present = そのプレイが始まったときの present + world
 */
export type FrameTime = {
  realDt: number;
  worldDt: number;
  real: number;
  world: number;
  present: number;
};

/**
 * present の時間軸で「十分に過去」と「十分に先」を表す時刻。まだ起きていない出来事の時刻にする。
 * シェーダーの uniform（f32）に入るので、経過時間の指数的な減衰が 0 になりきり、
 * かつシェーダーが足す 0.1 秒ほどの幅が f32 で丸め消えない桁にする（smoothstep の両端が同じ値になると、結果が決まらない）
 */
export const PRESENT_LONG_AGO = -1e4;
export const PRESENT_FAR_AHEAD = 1e6;
