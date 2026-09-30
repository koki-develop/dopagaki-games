import { abs, clamp, exp, float, Fn, fract, fwidth, If, Loop, max, min, mix, positionLocal, positionWorld, smoothstep, step, vec2, vec3, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { neon, sdRoundBox } from '../../../engine/tsl.ts';
import { RIPPLE } from '../config.ts';
import { LONG_AGO } from '../fx/discs.ts';
import { BOARD_FRAME } from '../geometry.ts';
import { BOARD_SIZE } from '../rules/position.ts';
import { LOOK } from './look.ts';
import { CPU_LINE_HUE, HUMAN_LINE_HUE } from './palette.ts';
import type { ViewUniforms } from './uniforms.ts';

const HALF = BOARD_SIZE / 2;
/** 盤の四隅の丸み */
const CORNER_RADIUS = 0.22;
/** 盤を描く四角形の余白（枠の光が収まるように） */
const PAD = 0.6;
/** 星（縦と横の 2 本目と 6 本目の線が交わる 4 つの点）の位置 */
const STARS = [
  [2, 2],
  [6, 2],
  [2, 6],
  [6, 6],
] as const;

/**
 * 盤。暗いガラスの地に、手番の色のネオンの線でマスを引く。枠は光り、四隅の星の点を打つ。
 * - 線の色は手番で変わる（人はミント、CPU はマゼンタ）。段階 4 の手、最高スコアの更新、勝ちの締めの波、パーフェクトの間は虹色に回る
 * - ビートと演出の強さで線が脈打ち、波紋が通ると線が光る
 * - キーボードのカーソル、押している・ホバーしているマス、最後に打ったマスを光らせる
 * - CPU の重い手の間は暗くなる（dread）
 * - 対局の始まりは、少し小さいところから広がって現れる（boardAppear）
 */
export class BoardView {
  readonly mesh: THREE.Mesh;

  constructor(u: ViewUniforms) {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.depthWrite = false;
    material.depthTest = false;

    const appear = u.boardAppear;
    const appearScale = mix(float(0.86), float(1), appear.mul(appear).mul(float(3).sub(appear.mul(2))));
    const span = BOARD_SIZE + (BOARD_FRAME + PAD) * 2;
    material.positionNode = vec3(positionLocal.xy.mul(span).mul(appearScale).add(HALF), 0);

    material.colorNode = Fn(() => {
      const t = u.time;
      // 盤の現れる拡大を戻して、盤の座標で描く
      const p = positionWorld.xy.sub(HALF).div(appearScale).add(HALF).toVar();
      const c = p.sub(HALF);
      const outer = sdRoundBox(c, vec2(HALF + BOARD_FRAME, HALF + BOARD_FRAME), CORNER_RADIUS);
      // smoothstep は edge0 < edge1 でしか結果が決まらないので、下がる段差は 1 から引いて作る
      const inBoard = float(1).sub(smoothstep(-0.02, 0.02, outer));

      // 地: 暗いガラス。中央がわずかに明るく、斜めの照り返しがゆっくり動く
      const radial = exp(c.dot(c).mul(-0.03));
      const sheenPhase = fract(p.x.add(p.y).mul(0.035).sub(u.real.mul(0.05)));
      const sheenD = sheenPhase.sub(0.5).div(0.06);
      const sheen = exp(sheenD.mul(sheenD).negate()).mul(0.25);
      const surface = mix(vec3(0.1, 0.45, 0.4), vec3(0.2, 0.8, 0.7), radial).mul(LOOK.board.surface).mul(float(1).add(sheen)).toVar();

      // 線の色: 手番で寄せ、虹色の強さ（u.rainbow）の間は色相を回す
      // 線の色は手番を表すので、背景のように色相をゆっくり回さない
      const lineHue = mix(float(CPU_LINE_HUE), float(HUMAN_LINE_HUE), u.turnTint).add(u.rainbowTurns).add(u.rainbow.mul(p.x.add(p.y).mul(0.06)));
      const lineCol = neon(lineHue);

      // 波紋: 線を光らせ、地を少し明るくする（石の跳ね（discs.ts）と同じ RIPPLE の値で描く）
      const ripple = float(0).toVar();
      Loop(RIPPLE.slots, ({ i }) => {
        const r = u.ripples.element(i);
        const age = t.sub(r.z);
        If(age.greaterThanEqual(0).and(age.lessThan(RIPPLE.life)), () => {
          const d = p.sub(r.xy).length().sub(age.mul(RIPPLE.speed));
          ripple.addAssign(exp(d.mul(d).mul(-RIPPLE.width)).mul(exp(age.mul(-RIPPLE.decay))).mul(r.w));
        });
      });

      // マスの線（盤の内側 0〜8 の整数の位置）。fwidth は分岐の外で求める
      const fw = fwidth(p).max(vec2(1e-4, 1e-4));
      const f = abs(fract(p.sub(0.5)).sub(0.5)).div(fw);
      const inGrid = step(-0.01, p.x).mul(step(p.x, BOARD_SIZE + 0.01)).mul(step(-0.01, p.y)).mul(step(p.y, BOARD_SIZE + 0.01));
      const line = float(1).sub(min(min(f.x, f.y), 1)).mul(inGrid);
      const gridLevel = float(LOOK.board.grid)
        .add(u.beat.mul(LOOK.board.gridBeat))
        .add(u.intensity.mul(LOOK.board.gridIntensity))
        .add(ripple.mul(LOOK.board.ripple));
      surface.addAssign(lineCol.mul(line).mul(gridLevel));
      // 線のにじみ（線の近くだけ）
      const nearLine = min(min(f.x, f.y), 30).mul(min(fw.x, fw.y));
      surface.addAssign(lineCol.mul(exp(nearLine.mul(-18)).mul(0.08).mul(inGrid).mul(float(1).add(ripple))));
      surface.addAssign(lineCol.mul(ripple.mul(0.05)).mul(inGrid));

      // 星
      for (const [sx, sy] of STARS) {
        const sd = p.sub(vec2(sx, sy)).length();
        surface.addAssign(lineCol.mul(exp(sd.mul(sd).mul(-400)).mul(gridLevel).mul(1.4)));
      }

      // マスの光: カーソル、押している・ホバーしているマス、最後に打ったマス
      const cellGlow = (cx: Node<'float'>, cy: Node<'float'>) => {
        const d = sdRoundBox(p.sub(vec2(cx, cy)), vec2(0.46, 0.46), 0.08);
        return float(1).sub(smoothstep(-0.03, 0.03, d)).mul(0.35).add(exp(abs(d).mul(-40)));
      };
      const cursorGlow = cellGlow(u.cursor.x, u.cursor.y).mul(u.cursor.z).mul(LOOK.board.cursor);
      surface.addAssign(vec3(0.85, 0.95, 1).mul(cursorGlow));
      // 人の打てるマスは人の石の縁の色、打てないマスは灰色
      const hoverCol = mix(vec3(0.5, 0.5, 0.55), neon(u.markerHue), clamp(u.hover.w, 0, 1));
      surface.addAssign(hoverCol.mul(cellGlow(u.hover.x, u.hover.y).mul(u.hover.z).mul(LOOK.board.cursor)));
      const lastAge = t.sub(u.lastMove.z);
      // まだ打っていないとき（時刻が十分に過去）は光らせない
      const played = step(LONG_AGO / 2, u.lastMove.z);
      const lastGlow = cellGlow(u.lastMove.x, u.lastMove.y).mul(exp(lastAge.mul(-1.4)).mul(0.8).add(0.18)).mul(step(0, lastAge)).mul(played).mul(LOOK.board.lastMove);
      surface.addAssign(lineCol.mul(lastGlow));

      // 枠: 盤の外周に沿って光る
      const frameGlow = exp(abs(outer).mul(-40)).mul(LOOK.board.frame).add(exp(abs(outer).mul(-7)).mul(0.25));
      const frameCol = lineCol.mul(frameGlow.mul(float(1).add(u.beat.mul(0.3)).add(ripple.mul(0.4))));

      // CPU の重い手の間は暗くする
      const dim = float(1).sub(u.dread.mul(0.55));
      const col = surface.mul(inBoard).add(frameCol).mul(dim).mul(appear);
      const alpha = clamp(inBoard.mul(0.96).add(frameGlow.mul(0.8)), 0, 1).mul(appear);
      return vec4(max(col, vec3(0, 0, 0)), alpha);
    })();

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
