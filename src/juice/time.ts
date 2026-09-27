import { clamp01, easeInOutCubic } from '../shared/math.ts';

type SlowMo = { scale: number; start: number; hold: number; release: number };

/**
 * 世界の時間の流れを管理する。1 回のプレイごとに作り、実時間を 0 から数える。
 * 遅くするのは世界（sim と演出）の時間だけで、入力・パドル・UI は実時間で動かし続ける。
 * 時間の長さはすべて実時間の秒で指定する。
 */
export class WorldClock {
  /** 実時間の累計（秒）。スローモーションの始まりと終わりをこの時間軸で持つ */
  private realT = 0;
  private readonly slowMos: SlowMo[] = [];

  /** 実時間 dt 秒を進め、世界時間の増分を返す。倍率はフレームの区間の中央の時刻で決める */
  advance(dt: number): number {
    const t0 = this.realT;
    this.realT = t0 + dt;
    const worldDt = dt * this.slowScaleAt(t0 + dt / 2);
    for (let i = this.slowMos.length - 1; i >= 0; i--) {
      const s = this.slowMos[i];
      if (this.realT >= s.start + s.hold + s.release) this.slowMos.splice(i, 1);
    }
    return worldDt;
  }

  /**
   * 世界の時間を scale 倍に落とし、hold 秒保ってから release 秒かけて等速に戻す。
   * release に Infinity を渡すと、戻さずにその倍率のままにする。
   */
  slowMo(scale: number, hold: number, release: number): void {
    this.slowMos.push({ scale, start: this.realT, hold, release });
  }

  private slowScaleAt(at: number): number {
    let scale = 1;
    for (const s of this.slowMos) {
      const t = at - s.start;
      let k: number;
      if (t < s.hold) k = s.scale;
      else if (!Number.isFinite(s.release)) k = s.scale;
      else k = s.scale + (1 - s.scale) * easeInOutCubic(clamp01((t - s.hold) / s.release));
      if (k < scale) scale = k;
    }
    return scale;
  }
}
