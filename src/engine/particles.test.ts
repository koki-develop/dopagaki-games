import { describe, expect, test } from 'bun:test';
import { uniform, vec2 } from 'three/tsl';
import type * as THREE from 'three/webgpu';
import { reversedSmoothsteps, unguardedPows } from './node-graph.test-support.ts';
import { ParticlesView } from './particles.ts';
import { FocusVignette, ScreenFlash } from './screen-fx.ts';

type NodeMaterial = THREE.MeshBasicNodeMaterial;

/** 材質のシェーダーの式（位置と色） */
const roots = (mesh: THREE.Mesh) => {
  const m = mesh.material as NodeMaterial;
  return [m.positionNode, m.colorNode].filter((n) => n !== null);
};

describe('engine のシェーダー', () => {
  const meshes: [string, THREE.Mesh][] = [
    ['ParticlesView', new ParticlesView({ capacity: 8, time: uniform(0), brightness: 1, renderOrder: 0 }).mesh],
    [
      'ParticlesView（吸い込み）',
      new ParticlesView({ capacity: 8, time: uniform(0), brightness: 1, renderOrder: 0, attract: { point: vec2(0, 0), amount: uniform(0) } }).mesh,
    ],
    ['ScreenFlash', new ScreenFlash({ level: uniform(0), renderOrder: 0 }).mesh],
    [
      'FocusVignette',
      new FocusVignette({ strength: uniform(0), focus: vec2(0, 0), outerRadius: 4, innerRadius: 1, band: 1, darkness: 0.8, renderOrder: 0 }).mesh,
    ],
  ];

  test.each(meshes)('%s: smoothstep の両端を逆にせず、pow の底は負にならない', (_name, mesh) => {
    for (const root of roots(mesh)) {
      expect(reversedSmoothsteps(root)).toEqual([]);
      expect(unguardedPows(root)).toHaveLength(0);
    }
  });
});
