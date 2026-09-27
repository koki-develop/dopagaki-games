/** セルの添字 i から決まる 0〜1 の乱数。同じ i にはいつも同じ値を返す */
export function cellRandom(i: number): number {
  const v = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

/** 添字 0〜n-1 の cellRandom を f32 で並べた表 */
export function cellRandomTable(n: number): Float32Array {
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = cellRandom(i);
  return t;
}
