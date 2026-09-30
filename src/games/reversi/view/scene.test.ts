import { describe, expect, test } from 'bun:test';
import type * as THREE from 'three/webgpu';
import type { FrameTime } from '../../../juice/frame-time.ts';
import { RIPPLE, SHOCKWAVE } from '../config.ts';
import { LONG_AGO } from '../fx/discs.ts';
import { createFxState } from '../fx/fx-state.ts';
import { reaches, reversedSmoothsteps } from '../../../engine/node-graph.test-support.ts';
import { ReversiView } from './scene.ts';

const frame = (): FrameTime => ({ realDt: 1 / 60, worldDt: 1 / 60, real: 3, world: 2, present: 7 });

describe('ReversiView の uniform', () => {
  test('演出の状態をそのまま uniform へ写し、bloom と RGB のずれを描画一式へ渡す', () => {
    const view = new ReversiView();
    const post: string[] = [];
    view.setPost({ setBloom: (s, r, t) => void post.push(`bloom ${s} ${r} ${t}`), setAberration: (a, angle) => void post.push(`ab ${a} ${angle}`) });
    post.length = 0;
    const fx = createFxState();
    fx.flash = 0.3;
    fx.rays = 0.4;
    fx.hitShake = 0.5;
    fx.aberration = 0.01;
    fx.aberrationAngle = 1;
    fx.bloomStrength = 0.9;
    fx.ripples.set([1, 2, 3, 0.5], 4);
    fx.shockwaves.set([4, 4, 5, 11], 0);
    fx.shockwaves.set([4, 4, 5.3, 15], 4);
    const u = view.uniforms;
    view.apply(fx, frame(), 0.5);
    expect([u.time.value, u.real.value, u.flash.value, u.rays.value]).toEqual([7, 3, 0.3, 0.4]);
    // 止めた石の震えと RGB のずれには、画面の揺れの倍率を掛ける
    expect(u.hit.value.z).toBeCloseTo(0.25, 9);
    expect(post).toContain('ab 0.005 1');
    expect(post.some((p) => p.startsWith('bloom 0.9 '))).toBe(true);
    const ripples = u.ripples.array as THREE.Vector4[];
    const shocks = u.shockwaves.array as THREE.Vector4[];
    expect(ripples).toHaveLength(RIPPLE.slots);
    expect(shocks).toHaveLength(SHOCKWAVE.slots);
    expect(ripples[1].toArray()).toEqual([1, 2, 3, 0.5]);
    expect([shocks[0].toArray(), shocks[1].toArray()]).toEqual([
      [4, 4, 5, 11],
      [4, 4, Math.fround(5.3), 15],
    ]);
  });

  test('演出の状態のすべての値を、対応する uniform へ写す', () => {
    const view = new ReversiView();
    const fx = createFxState();
    Object.assign(fx, {
      beat: 0.1,
      fever: 0.2,
      hitX: 1,
      hitY: 2,
      impactX: 3,
      impactY: 4,
      impactAt: 5,
      impactStrength: 0.6,
      intensity: 0.7,
      hue: 0.8,
      glow: 0.9,
      rainbow: 0.11,
      rainbowTurns: 1.2,
      turnTint: 0.13,
      dread: 0.14,
      cursorX: 6,
      cursorY: 7,
      cursor: 0.15,
      hoverX: 8,
      hoverY: 9,
      hover: 0.16,
      hoverLegal: -1,
      markerHue: 0.17,
      boardAppear: 0.18,
      lastX: 10,
      lastY: 11,
      lastAt: 12,
    });
    view.apply(fx, frame(), 1);
    const u = view.uniforms;
    expect([u.beat.value, u.fever.value, u.intensity.value, u.hue.value, u.glow.value]).toEqual([0.1, 0.2, 0.7, 0.8, 0.9]);
    expect([u.rainbow.value, u.rainbowTurns.value, u.turnTint.value, u.dread.value, u.markerHue.value, u.boardAppear.value]).toEqual([0.11, 1.2, 0.13, 0.14, 0.17, 0.18]);
    expect(u.hit.value.toArray().slice(0, 2)).toEqual([1, 2]);
    expect(u.impact.value.toArray()).toEqual([3, 4, 5, 0.6]);
    expect(u.cursor.value.toArray()).toEqual([6, 7, 0.15]);
    expect(u.hover.value.toArray()).toEqual([8, 9, 0.16, -1]);
    expect(u.lastMove.value.toArray()).toEqual([10, 11, 12]);
  });

  test('まだ起きていない波紋と衝撃波（開始時刻が LONG_AGO）は、描く長さの外にあるので描かれない', () => {
    const fx = createFxState();
    for (let i = 0; i < RIPPLE.slots; i++) expect(fx.ripples[i * 4 + 2]).toBe(LONG_AGO);
    for (let i = 0; i < SHOCKWAVE.slots; i++) expect(fx.shockwaves[i * 4 + 2]).toBe(LONG_AGO);
    // present は 0 から増えるだけなので、経過時間は -LONG_AGO 以上になる
    expect(-LONG_AGO).toBeGreaterThan(RIPPLE.life);
    expect(-LONG_AGO).toBeGreaterThan(SHOCKWAVE.life);
  });
});

describe('ReversiView のシェーダー', () => {
  test('波紋は、盤の線と石の跳ねの両方のシェーダーから読む', () => {
    const view = new ReversiView();
    const u = view.uniforms;
    const discs = view.discs.mesh.material as THREE.NodeMaterial;
    const board = view.board.mesh.material as THREE.NodeMaterial;
    if (!discs.colorNode || !board.colorNode) throw new Error('no color node');
    expect(reaches(discs.colorNode, u.ripples)).toBe(true);
    expect(reaches(board.colorNode, u.ripples)).toBe(true);
  });

  test('どのシェーダーも、写した演出の状態の uniform を読む', () => {
    const view = new ReversiView();
    const u = view.uniforms;
    const node = (m: THREE.Mesh, key: 'colorNode' | 'positionNode') => {
      const n = (m.material as THREE.NodeMaterial)[key];
      if (!n) throw new Error(`no ${key}`);
      return n;
    };
    const discsPos = node(view.discs.mesh, 'positionNode');
    const discsCol = node(view.discs.mesh, 'colorNode');
    const board = node(view.board.mesh, 'colorNode');
    const boardPos = node(view.board.mesh, 'positionNode');
    const background = node(view.background.mesh, 'colorNode');
    const impact = node(view.impact.mesh, 'colorNode');
    // 止めた石の震えは実時間で動く
    for (const x of [u.time, u.real, u.hit]) expect(reaches(discsPos, x)).toBe(true);
    for (const x of [u.time, u.beat, u.markerHue, u.ripples]) expect(reaches(discsCol, x)).toBe(true);
    for (const x of [u.time, u.real, u.beat, u.intensity, u.turnTint, u.rainbow, u.rainbowTurns, u.cursor, u.hover, u.markerHue, u.lastMove, u.dread, u.boardAppear]) {
      expect(reaches(board, x)).toBe(true);
    }
    expect(reaches(boardPos, u.boardAppear)).toBe(true);
    for (const x of [u.time, u.real, u.fever, u.beat, u.intensity, u.hue, u.glow, u.rays, u.rainbowTurns, u.turnTint, u.dread]) expect(reaches(background, x)).toBe(true);
    for (const x of [u.real, u.impact]) expect(reaches(impact, x)).toBe(true);
  });

  test('smoothstep の両端は、どのシェーダーでも edge0 < edge1', () => {
    const view = new ReversiView();
    for (const mesh of [view.background.mesh, view.board.mesh, view.discs.mesh, view.impact.mesh]) {
      const m = mesh.material as THREE.NodeMaterial;
      for (const n of [m.colorNode, m.positionNode]) if (n) expect(reversedSmoothsteps(n)).toEqual([]);
    }
  });

  test('衝撃波は、背景のシェーダーから全部の枠を読む', () => {
    const view = new ReversiView();
    const background = view.background.mesh.material as THREE.NodeMaterial;
    if (!background.colorNode) throw new Error('no color node');
    expect(reaches(background.colorNode, view.uniforms.shockwaves)).toBe(true);
  });
});
