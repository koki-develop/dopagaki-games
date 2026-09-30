import { describe, expect, test } from 'bun:test';
import { clamp, float, Fn, smoothstep, uniform } from 'three/tsl';
import { findNodes, isPow, reaches, reversedSmoothsteps, unguardedPows } from './node-graph.test-support.ts';

describe('node-graph.test-support', () => {
  test('Fn の中身まで辿る', () => {
    const u = uniform(1);
    const root = Fn(() => float(2).add(u).pow(3))();
    expect(reaches(root, u)).toBe(true);
    expect(findNodes(root, isPow).length).toBeGreaterThan(0);
    expect(reaches(float(1).add(2), u)).toBe(false);
  });

  test('両端が逆の smoothstep を見つける', () => {
    const x = uniform(0.5);
    expect(reversedSmoothsteps(smoothstep(1, 0.85, x))).toEqual([[1, 0.85]]);
    expect(reversedSmoothsteps(float(1).sub(smoothstep(0.85, 1, x)))).toEqual([]);
  });

  test('底が負にならないと分からない pow を見つける', () => {
    const x = uniform(0.5);
    expect(unguardedPows(float(1).sub(x).pow(1.4))).toHaveLength(1);
    expect(unguardedPows(float(1).sub(x).max(0).pow(1.4))).toHaveLength(0);
    expect(unguardedPows(clamp(x, 0, 1).pow(2))).toHaveLength(0);
  });
});
