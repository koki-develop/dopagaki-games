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
