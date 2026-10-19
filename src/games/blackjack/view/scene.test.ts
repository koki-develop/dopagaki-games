import { describe, expect, test } from 'bun:test';
import type * as THREE from 'three/webgpu';
import { reaches, reversedSmoothsteps, unguardedPows } from '../../../engine/node-graph.test-support.ts';
import type { FrameTime } from '../../../juice/frame-time.ts';
import { SHOCKWAVE } from '../config.ts';
import { createFxState } from '../fx/fx-state.ts';
import { MAX_HANDS } from '../rules/round.ts';
import { BlackjackView } from './scene.ts';

const frame = (): FrameTime => ({ realDt: 1 / 60, worldDt: 1 / 60, real: 3, world: 2, present: 7 });

const node = (m: THREE.Mesh, key: 'colorNode' | 'positionNode') => {
  const n = (m.material as THREE.NodeMaterial)[key];
  if (!n) throw new Error(`no ${key}`);
  return n;
};

describe('BlackjackView の uniform', () => {
  test('演出の状態のすべての値を、対応する uniform へ写し、bloom と RGB のずれを描画一式へ渡す', () => {
    const view = new BlackjackView();
    const post: string[] = [];
    view.setPost({ setBloom: (s, r, t) => void post.push(`bloom ${s} ${r} ${t}`), setAberration: (a, angle) => void post.push(`ab ${a} ${angle}`) });
    post.length = 0;
    const fx = createFxState();
    Object.assign(fx, {
      beat: 0.1,
      fever: 0.2,
      hitShake: 0.5,
      impactX: 3,
      impactY: 4,
      impactAt: 5,
      impactStrength: 0.6,
      aberration: 0.01,
      aberrationAngle: 1,
      intensity: 0.7,
      hue: 0.8,
      glow: 0.9,
      flash: 0.3,
      rays: 0.4,
      rainbow: 0.25,
      rainbowTurns: 1.5,
      dread: 0.35,
      bloomStrength: 0.9,
      focus: 0.45,
      focusX: 6,
      focusY: 7,
      tableAppear: 0.5,
      active: 0.75,
      activeX: 5,
      activeY: 5,
      activeHW: 1.2,
      activeHH: 1.6,
      finalRound: 1,
    });
    fx.shockwaves.set([4, 4, 5, 11], 4);
    fx.spots.set([2, 3, 0.9, 1], 4);
    const u = view.uniforms;
    view.apply(fx, frame(), 0.5);
    expect([u.time.value, u.real.value, u.beat.value, u.fever.value]).toEqual([7, 3, 0.1, 0.2]);
    // 止めたカードの震えと RGB のずれには、画面の揺れの倍率を掛ける
    expect(u.hitShake.value).toBeCloseTo(0.25, 9);
    expect(post).toContain('ab 0.005 1');
    expect(post.some((p) => p.startsWith('bloom 0.9 '))).toBe(true);
    expect(u.impact.value.toArray()).toEqual([3, 4, 5, 0.6]);
    expect([u.intensity.value, u.hue.value, u.glow.value, u.flash.value, u.rays.value, u.rainbow.value, u.rainbowTurns.value, u.dread.value]).toEqual([0.7, 0.8, 0.9, 0.3, 0.4, 0.25, 1.5, 0.35]);
    expect([u.focus.value, u.focusPoint.value.x, u.focusPoint.value.y]).toEqual([0.45, 6, 7]);
    expect([u.tableAppear.value, u.active.value, u.finalRound.value]).toEqual([0.5, 0.75, 1]);
    expect(u.activeRect.value.toArray()).toEqual([5, 5, 1.2, 1.6]);
    expect((u.shockwaves.array as THREE.Vector4[])[1].toArray()).toEqual([4, 4, 5, 11]);
    expect((u.spots.array as THREE.Vector4[])).toHaveLength(MAX_HANDS);
    expect((u.spots.array as THREE.Vector4[])[1].toArray()).toEqual([2, 3, Math.fround(0.9), 1]);
    expect(u.shockwaves.array).toHaveLength(SHOCKWAVE.slots);
  });
});

describe('BlackjackView のシェーダー', () => {
  test('どのシェーダーも、写した演出の状態の uniform を読む', () => {
    const view = new BlackjackView();
    const u = view.uniforms;
    const cardsPos = node(view.cards.mesh, 'positionNode');
    const cardsCol = node(view.cards.mesh, 'colorNode');
    const chipsPos = node(view.chips.mesh, 'positionNode');
    const table = node(view.table.mesh, 'colorNode');
    const background = node(view.background.mesh, 'colorNode');
    // 止めたカードとチップの震えは実時間で動く
    for (const x of [u.time, u.real, u.hitShake]) expect(reaches(cardsPos, x)).toBe(true);
    for (const x of [u.time, u.real, u.hitShake]) expect(reaches(chipsPos, x)).toBe(true);
    expect(reaches(cardsCol, u.real)).toBe(true);
    for (const x of [u.real, u.beat, u.intensity, u.rainbow, u.rainbowTurns, u.tableAppear, u.activeRect, u.active, u.spots, u.finalRound]) {
      expect(reaches(table, x)).toBe(true);
    }
    for (const x of [u.time, u.real, u.fever, u.beat, u.intensity, u.hue, u.glow, u.rays, u.rainbowTurns, u.dread, u.shockwaves]) expect(reaches(background, x)).toBe(true);
    expect(reaches(node(view.impact.mesh, 'colorNode'), u.impact)).toBe(true);
    expect(reaches(node(view.vignette.mesh, 'colorNode'), u.focus)).toBe(true);
  });

  test('smoothstep の両端は edge0 < edge1 で、pow の底は負にならない', () => {
    const view = new BlackjackView();
    for (const mesh of [view.background.mesh, view.table.mesh, view.cards.mesh, view.chips.mesh, view.chips.shadow]) {
      const m = mesh.material as THREE.NodeMaterial;
      for (const n of [m.colorNode, m.positionNode]) {
        if (!n) continue;
        expect(reversedSmoothsteps(n)).toEqual([]);
        expect(unguardedPows(n)).toHaveLength(0);
      }
    }
  });
});
