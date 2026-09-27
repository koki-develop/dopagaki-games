/**
 * 1 秒あたりの発生回数を、時定数 tau 秒で指数的にならして測る。
 *
 * フレームごとの回数を減衰させながら溜め、一定のペース λ で起き続けたときに λ そのものを返すよう換算する。
 * 溜めた値は λ·dt / (1 - e^(-dt/tau)) に収束するので、それに (1 - e^(-dt/tau)) / dt を掛けて λ へ戻す。
 * こうするとフレームレートによらず同じ値になる。dt が 0 のときは、その極限の 1 / tau を掛ける。
 */
export class EventRate {
  private readonly tau: number;
  private acc = 0;
  private value = 0;

  /** @param tau ならす時定数（秒） */
  constructor(tau: number) {
    this.tau = tau;
  }

  /** 1 秒あたりの発生回数（ならした値）。update() で更新する */
  get rate(): number {
    return this.value;
  }

  /** dt 秒の間に count 回起きた。更新した rate を返す */
  update(count: number, dt: number): number {
    const tau = this.tau;
    if (dt > 0) {
      const keep = Math.exp(-dt / tau);
      this.acc = this.acc * keep + count;
      this.value = (this.acc * (1 - keep)) / dt;
    } else {
      this.acc += count;
      this.value = this.acc / tau;
    }
    return this.value;
  }
}
