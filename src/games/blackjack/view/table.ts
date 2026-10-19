import { abs, clamp, exp, float, Fn, max, mix, positionLocal, positionWorld, sin, step, texture, vec2, vec3, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { neon, sdRoundBox } from '../../../engine/tsl.ts';
import { TABLE_H, TABLE_W } from '../geometry.ts';
import { MAX_HANDS } from '../rules/round.ts';
import { paintedTexture } from './canvas.ts';
import { FELT_H, FELT_PAD, FELT_W, paintFeltPrint, paintTableProps } from './felt-art.ts';
import { LOOK } from './look.ts';
import { GOLD_RGB } from './palette.ts';
import type { ViewUniforms } from './uniforms.ts';

const CX = TABLE_W / 2;
const SIZE_W = TABLE_W + FELT_PAD * 2;
const SIZE_H = TABLE_H + FELT_PAD * 2;

const sq = (v: Node<'float'>): Node<'float'> => v.mul(v);
const line = (d: Node<'float'>, width: number): Node<'float'> => exp(sq(d.div(width)).negate());

/**
 * 卓。背景（フェルトの地）の上、チップとカードの下に重ねる。
 * - フェルトの印刷（felt-art.ts で描いたテクスチャ）。演出の強さとビートで少し明るくなり、虹色の間は色が回り、最後のラウンドは脈打つ
 * - 卓の道具（チップラック・シュー。別のテクスチャ）
 * - 賭けの丸（手ごとに 1 つ。金の二重線）
 * - 操作を待っている手のまわりの光
 * - プレイの始まりは、少し小さいところから広がって現れる（tableAppear）
 */
export class TableView {
  readonly mesh: THREE.Mesh;
  private readonly print = paintedTexture(FELT_W, FELT_H, paintFeltPrint);
  private readonly props = paintedTexture(FELT_W, FELT_H, paintTableProps);

  constructor(u: ViewUniforms) {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.depthWrite = false;
    material.depthTest = false;
    const appear = u.tableAppear;
    const appearScale = mix(float(0.9), float(1), appear.mul(appear).mul(float(3).sub(appear.mul(2))));
    material.positionNode = vec3(positionLocal.xy.mul(vec2(SIZE_W, SIZE_H)).add(vec2(CX, TABLE_H / 2)), 0);

    material.colorNode = Fn(() => {
      const p = positionWorld.xy.sub(vec2(CX, TABLE_H / 2)).div(appearScale).add(vec2(CX, TABLE_H / 2)).toVar();
      const feltUv = vec2(p.x.add(FELT_PAD).div(SIZE_W), p.y.add(FELT_PAD).div(SIZE_H));
      const print = texture(this.print, feltUv);
      const props = texture(this.props, feltUv);
      const pulse = float(1)
        .add(u.beat.mul(LOOK.table.lineBeat))
        .add(u.intensity.mul(0.3))
        .add(u.finalRound.mul(sin(u.real.mul(5)).mul(0.5).add(0.5)).mul(LOOK.table.finalRound));
      const rainbow = neon(p.x.mul(0.08).add(u.rainbowTurns)).mul(1.4);
      const printCol = mix(print.rgb, print.rgb.mul(rainbow), u.rainbow.mul(0.8)).mul(LOOK.table.print).mul(pulse);
      // 色は不透明度を掛けた値で重ね（over）、最後に不透明度で割り戻す
      const col = printCol.mul(print.a).toVar();
      const alpha = print.a.toVar();
      const over = (rgb: Node<'vec3'>, a: Node<'float'>) => {
        col.assign(col.mul(float(1).sub(a)).add(rgb.mul(a)));
        alpha.assign(alpha.add(a.mul(float(1).sub(alpha))));
      };
      over(props.rgb, props.a);

      // 賭けの丸: 金の二重線
      for (let i = 0; i < MAX_HANDS; i++) {
        const s = u.spots.element(i);
        const d = abs(p.sub(s.xy).length().sub(s.z));
        const ring = line(d, 0.025).add(line(abs(d.sub(0.1)), 0.012).mul(0.6)).mul(s.w).mul(LOOK.table.spot);
        over(vec3(...GOLD_RGB).mul(pulse), clamp(ring, 0, 1));
      }

      // 操作を待っている手のまわりの光: 角の丸い枠が脈打つ
      const ar = u.activeRect;
      const box = sdRoundBox(p.sub(ar.xy), ar.zw, 0.25);
      const breathe = sin(u.real.mul(5)).mul(0.25).add(0.75);
      const activeGlow = line(abs(box), 0.05).add(exp(max(box, 0).mul(-6)).mul(0.25).mul(step(0, box))).mul(u.active).mul(breathe).mul(LOOK.table.active);
      over(vec3(1, 0.93, 0.75), clamp(activeGlow, 0, 1));

      return vec4(col.div(max(alpha, 1e-4)), alpha.mul(appear));
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.print.dispose();
    this.props.dispose();
  }
}
