import { abs, clamp, float, fract, length, max, min, mix, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { NEON_SATURATION } from './neon.ts';

type F = Node<'float'> | number;
type V2 = Node<'vec2'>;

/** 値を毎フレーム書き換える float の uniform */
export type FloatUniform = Node<'float'> & { value: number };

const toFloat = (v: F): Node<'float'> => (typeof v === 'number' ? float(v) : v);

/**
 * ネオンの色。t は色相（0 赤、1/3 緑、1/2 シアン、2/3 青、5/6 マゼンタ）で、1 増えると 1 周する。
 * 彩度を少し落とした明るい色だけを返すので、どの t でも暗くならない。CPU では neonRgb（neon.ts）が同じ色を返す。
 */
export function neon(t: F) {
  const h = toFloat(t);
  const k = clamp(abs(fract(h.add(vec3(1, 2 / 3, 1 / 3))).mul(6).sub(3)).sub(1), 0, 1);
  return mix(vec3(1, 1, 1), k, NEON_SATURATION);
}

/** 角の丸い矩形の符号付き距離。p は中心基準、halfSize は半分の大きさ */
export function sdRoundBox(p: V2, halfSize: V2, radius: F) {
  const r = toFloat(radius);
  const q = abs(p).sub(halfSize).add(r);
  return length(max(q, vec2(0, 0))).add(min(max(q.x, q.y), 0)).sub(r);
}

/** 線分 a-b までの距離 */
export function sdSegment(p: V2, a: V2, b: V2) {
  const pa = p.sub(a);
  const ba = b.sub(a);
  const h = pa.dot(ba).div(ba.dot(ba).max(1e-6)).clamp(0, 1);
  return length(pa.sub(ba.mul(h)));
}
