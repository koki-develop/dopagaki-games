import { easeInOutCubic, ramp } from '../shared/math.ts';

type SlowMo = { scale: number; start: number; hold: number; release: number };

/**
 * 世界の時間の流れを管理する。1 回のプレイごとに作り、実時間を 0 から数える。
 * 遅くするのは世界（sim と演出）の時間だけで、入力・パドル・UI は実時間で動かし続ける。
 * 時間の長さは、slowMoWorld の hold を除いて実時間の秒で指定する。
 */
export class WorldClock {
  /** 実時間の累計（秒）。スローモーションの始まりと終わりをこの時間軸で持つ */
  private realT = 0;
  private readonly slowMos: SlowMo[] = [];
  /** 世界の時間を止めておく終わりの時刻（実時間） */
  private stopUntil = 0;

  /**
   * 実時間 dt 秒を進め、世界時間の増分を返す。止めている区間と重なった長さは進めず、
   * 残りの長さにスローモーションの倍率（フレームの区間の中央の時刻で決める）を掛ける
   */
  advance(dt: number): number {
    const t0 = this.realT;
    const t1 = t0 + dt;
    this.realT = t1;
    const stopped = Math.max(0, Math.min(t1, this.stopUntil) - t0);
    const worldDt = (dt - stopped) * this.slowScaleAt(t0 + dt / 2);
    for (let i = this.slowMos.length - 1; i >= 0; i--) {
      const s = this.slowMos[i];
      if (this.realT >= s.start + s.hold + s.release) this.slowMos.splice(i, 1);
    }
    return worldDt;
  }

  /** 今から duration 秒（実時間）、世界の時間を止める（ヒットストップ）。止めている間に呼ぶと、遅く終わるほうまで止める */
  hitStop(duration: number): void {
    if (duration <= 0) return;
    this.stopUntil = Math.max(this.stopUntil, this.realT + duration);
  }

  /**
   * 世界の時間を scale 倍に落とし、hold 秒保ってから release 秒かけて等速に戻す。
   * release に Infinity を渡すと、戻さずにその倍率のままにする。
   */
  slowMo(scale: number, hold: number, release: number): void {
    this.slowMos.push({ scale, start: this.realT, hold, release });
  }

  /**
   * slowMo と同じだが、倍率を保つ長さ worldHold を世界時間の秒で指定する（実時間では worldHold / scale 秒保つ）。
   * 世界の中で起きることの長さに合わせて遅くするときに使う。release は実時間の秒
   */
  slowMoWorld(scale: number, worldHold: number, release: number): void {
    this.slowMo(scale, scale > 0 ? worldHold / scale : Infinity, release);
  }

  private slowScaleAt(at: number): number {
    let scale = 1;
    for (const s of this.slowMos) {
      const t = at - s.start;
      // release が Infinity なら ramp は 0 のままで、倍率を保つ
      const k = t < s.hold ? s.scale : s.scale + (1 - s.scale) * easeInOutCubic(ramp(t - s.hold, s.release));
      if (k < scale) scale = k;
    }
    return scale;
  }
}
