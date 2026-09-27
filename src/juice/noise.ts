/**
 * 1 次元の Perlin ノイズ（勾配ノイズ）。出力はおよそ -1〜1。
 * カメラシェイクの揺れを、乱数ではなく滑らかに連続した値から取るために使う。
 */
export class Noise1D {
  private readonly grad = new Float32Array(256);
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    let s = seed >>> 0 || 1;
    const rand = () => {
      // xorshift32
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
      this.grad[i] = rand() * 2 - 1;
    }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  sample(x: number): number {
    const xi = Math.floor(x);
    const xf = x - xi;
    const i0 = xi & 255;
    const g0 = this.grad[this.perm[i0]];
    const g1 = this.grad[this.perm[i0 + 1]];
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const n0 = g0 * xf;
    const n1 = g1 * (xf - 1);
    // 勾配の大きさが最大 1 のとき、振幅は最大 0.5 なので 2 倍して -1〜1 に揃える
    return (n0 + (n1 - n0) * u) * 2;
  }
}
