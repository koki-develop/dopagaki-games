import { describe, expect, test } from 'bun:test';
import { BlockType, COLS, tuning } from '../config.ts';
import { cellCenterX } from '../sim/blocks.ts';
import type { Sim } from '../sim/sim.ts';
import { dropAllBalls } from '../sim/sim.test-support.ts';
import { SOLID_RGB } from '../view/palette.ts';
import { FINALE_SETTLE, SHOCK_SPEED, SHOCK_TRAVEL } from './finale.ts';
import { GAME_OVER_FINISH } from './game-over.ts';
import { NewBest } from './peak.ts';
import { clearingSim, Harness, losingSim, SOLID_ROWS } from './test-kit.test-support.ts';

/** フィナーレで鳴る音（音の順番で段階の進み方を見る） */
const FINALE_SOUNDS = ['sfx.inhale', 'sfx.finaleBurst', 'sfx.bonusNote', 'sfx.resolveChord'];

/** 炸裂するまで進め、炸裂したフレームの世界時間を返す */
function toBurst(h: Harness): number {
  h.until(() => h.ended, 600);
  h.until(() => h.rec.count('sfx.finaleBurst') > 0, 60);
  return h.ft.world;
}

/** 残っている壊れないブロックの中心 */
function solidCenters(sim: Sim): [number, number][] {
  const f = sim.blocks;
  const out: [number, number][] = [];
  for (let row = 0; row < f.rowCount; row++) {
    for (let col = 0; col < COLS; col++) {
      if (f.type[f.slotOf(row) * COLS + col] === BlockType.Solid) out.push([cellCenterX(col), f.centerY(row)]);
    }
  }
  return out;
}

/**
 * 回収が済んだか（衝撃波がフィールドを渡りきり、ボールも届いていない光も残っていない）。
 * このフレームから余韻が始まり、FINALE_SETTLE 秒で着地する
 */
const collected = (h: Harness, burstWorld: number): boolean =>
  h.ft.world - burstWorld >= SHOCK_TRAVEL && h.sim.balls.count === 0 && h.sim.clearBonusRemaining === 0;

describe('Finale の段階', () => {
  test('溜め → 炸裂 → 回収 → 着地の順に一方向へ進み、着地の後に結果へ移る', () => {
    const h = new Harness({ sim: clearingSim(10) });
    h.until(() => h.finishes > 0, 800);
    h.run(300);
    const seen: string[] = [];
    for (const name of h.rec.names()) {
      if (!FINALE_SOUNDS.includes(name) && name !== 'onFinished') continue;
      if (seen[seen.length - 1] !== name) seen.push(name);
    }
    expect(seen).toEqual(['sfx.inhale', 'sfx.finaleBurst', 'sfx.bonusNote', 'sfx.resolveChord', 'onFinished']);
  });

  test('回収が済んでから 0.25 秒（実時間）で着地し、解決の和音を 1 回鳴らす', () => {
    const h = new Harness({ sim: clearingSim(10) });
    const burstWorld = toBurst(h);
    h.until(() => collected(h, burstWorld), 400);
    const settled = h.real;
    expect(h.rec.count('sfx.resolveChord')).toBe(0);
    h.until(() => h.rec.count('sfx.resolveChord') > 0, 60);
    expect(h.real - settled).toBeGreaterThanOrEqual(FINALE_SETTLE - 1e-9);
    expect(h.real - settled).toBeLessThan(FINALE_SETTLE + 1 / 60 + 1e-9);
    expect(h.rec.count('sfx.resolveChord')).toBe(1);
    expect(h.finishes).toBe(1);
    expect(h.sim.clearBonusRemaining).toBe(0);
  });

  test('光の到着は炸裂から 0.5〜0.8 秒（世界時間）の範囲に収まる', () => {
    const h = new Harness({ sim: clearingSim(30) });
    const burstWorld = toBurst(h);
    h.until(() => h.rec.count('sfx.bonusNote') > 0, 200);
    expect(h.ft.world - burstWorld).toBeGreaterThanOrEqual(0.5);
    const credited = h.sim.clearBonusRemaining;
    expect(credited).toBeLessThan(31);
    h.until(() => collected(h, burstWorld), 400);
    // 衝撃波が通り過ぎる 1.2 秒 + 最長の飛行 0.8 秒 + 1 フレーム以内
    expect(h.ft.world - burstWorld).toBeLessThan(1.2 + 0.8 + 2 / 60);
    expect(h.sim.score).toBeGreaterThanOrEqual(31 * tuning.score.pointsClearBall);
  });

  test('スキップは溜め・回収・余韻のどこでもでき、以後は何も鳴らさない。着地の後はできない', () => {
    const at: Record<string, (h: Harness, burstWorld: () => number) => boolean> = {
      hold: (h) => h.ended && h.rec.count('sfx.inhale') > 0,
      collect: (h) => h.rec.count('sfx.bonusNote') > 0,
      settle: (h, burstWorld) => h.rec.count('sfx.finaleBurst') > 0 && collected(h, burstWorld()),
    };
    for (const [name, reached] of Object.entries(at)) {
      const h = new Harness({ sim: clearingSim(10) });
      let burstWorld = Number.NaN;
      h.until(() => {
        if (Number.isNaN(burstWorld) && h.rec.count('sfx.finaleBurst') > 0) burstWorld = h.ft.world;
        return reached(h, () => burstWorld);
      }, 800);
      expect({ name, resolved: h.rec.count('sfx.resolveChord') }).toEqual({ name, resolved: 0 });
      expect(h.director.skip()).toBe(true);
      expect(h.finishes).toBe(1);
      const before = h.rec.calls.length;
      h.run(300);
      expect(h.rec.names(before).filter((n) => n.startsWith('sfx.'))).toEqual([]);
      expect(h.director.skip()).toBe(false);
    }
    const h = new Harness({ sim: clearingSim(10) });
    h.until(() => h.finishes > 0, 800);
    expect(h.rec.count('sfx.resolveChord')).toBe(1);
    expect(h.director.skip()).toBe(false);
  });

  test('溜めの途中で飛ばすと、吸い込む音をその場で止める。炸裂の後に飛ばしたときは止めるものがない', () => {
    const held = new Harness({ sim: clearingSim(10) });
    held.until(() => held.ended && held.rec.count('sfx.inhale') > 0, 600);
    expect(held.rec.count('sfx.inhale.stop')).toBe(0);
    expect(held.director.skip()).toBe(true);
    expect(held.rec.count('sfx.inhale.stop')).toBe(1);

    const burst = new Harness({ sim: clearingSim(10) });
    toBurst(burst);
    expect(burst.director.skip()).toBe(true);
    expect(burst.rec.count('sfx.inhale.stop')).toBe(0);
  });

  test('溜めの途中で飛ばすと、縁の絞り込みと吸い込みは飛ばしたときの値から 0.35 秒（実時間）でほどける', () => {
    const h = new Harness({ sim: clearingSim(10) });
    h.until(() => h.ended, 600);
    h.run(8);
    expect(h.rec.count('sfx.finaleBurst')).toBe(0);
    const vignette = h.fx.vignette;
    const inhale = h.fx.inhale;
    expect(vignette).toBeGreaterThan(0.2);
    expect(h.director.skip()).toBe(true);
    const skippedAt = h.real;
    h.frame();
    // 一気に 0 にはならず、飛ばしたときの値より小さくなっていく
    expect(h.fx.vignette).toBeGreaterThan(0);
    expect(h.fx.vignette).toBeLessThan(vignette);
    expect(h.fx.inhale).toBeLessThan(inhale);
    h.until(() => h.fx.vignette === 0, 60);
    expect(h.fx.inhale).toBe(0);
    expect(h.real - skippedAt).toBeLessThan(0.35 + 2 / 60 + 1e-9);
  });
});

describe('GameOver', () => {
  test('世界を 0.12 倍へ落とし、ボールを燃え尽きさせ、BGM を閉じる', () => {
    const sim = losingSim();
    const h = new Harness({ sim });
    h.frame();
    dropAllBalls(sim);
    h.frame();
    expect(h.rec.count('sfx.gameOver')).toBe(1);
    expect(h.rec.of('bgm.setOpenness').map((c) => c.args)).toEqual([[0.08, 1.4]]);
    expect(h.rec.of('bgm.setRiser').at(-1)?.args).toEqual([0]);
    h.run(90);
    expect(h.worldScale).toBeCloseTo(0.12, 6);
    expect(h.finishes).toBe(1);
    expect(h.real).toBeGreaterThan(GAME_OVER_FINISH);
  });
});

describe('NewBest', () => {
  test('HUD はいつでも前のベストとの比較、Peak はプレイ中に 1 回だけ', () => {
    const b = new NewBest(100);
    expect(b.isNewBest(100)).toBe(false);
    expect(b.isNewBest(101)).toBe(true);
    expect(b.check(150, false)).toBe(false);
    expect(b.check(50, true)).toBe(false);
    expect(b.check(150, true)).toBe(true);
    expect(b.check(200, true)).toBe(false);
  });

  test('前のベストが 0（記録がない）ときは、得点すれば新記録だが、Peak は出さない', () => {
    const b = new NewBest(0);
    expect(b.isNewBest(0)).toBe(false);
    expect(b.isNewBest(1)).toBe(true);
    expect(b.check(100000, true)).toBe(false);
    expect(b.check(100000, true)).toBe(false);
  });
});

describe('壊れないブロックの破砕', () => {
  test('衝撃波が中心を通過したものから順に砕け、渡りきったときには残らない。得点は変わらない', () => {
    const h = new Harness({ sim: clearingSim(10, undefined, SOLID_ROWS) });
    h.particles.keep = true;
    const total = solidCenters(h.sim).length;
    expect(total).toBe(12);
    h.until(() => h.ended, 600);
    // 溜めの間は砕けない
    expect(solidCenters(h.sim).length).toBe(total);
    const burstWorld = toBurst(h);
    const cx = h.fx.shockX;
    const cy = h.fx.shockY;
    const target = h.sim.score + h.sim.clearBonusRemaining * tuning.score.pointsClearBall;
    let partial = 0;
    let soundFrames = 0;
    for (let i = 0; i < 120 && h.ft.world - burstWorld < SHOCK_TRAVEL; i++) {
      const before = solidCenters(h.sim).length;
      const sounds = h.rec.count('sfx.solidShatter');
      h.frame();
      const left = solidCenters(h.sim);
      const r = (h.ft.world - burstWorld) * SHOCK_SPEED;
      for (const [x, y] of left) expect(Math.hypot(x - cx, y - cy)).toBeGreaterThan(r);
      if (left.length > 0 && left.length < total) partial++;
      // 音は砕けたフレームでだけ鳴る
      if (h.rec.count('sfx.solidShatter') > sounds) {
        soundFrames++;
        expect(left.length).toBeLessThan(before);
      }
    }
    expect(partial).toBeGreaterThan(2);
    expect(soundFrames).toBeGreaterThan(0);
    h.frame();
    expect(solidCenters(h.sim).length).toBe(0);
    expect(h.sim.blocks.liveCount).toBe(0);
    // 砕けた光は鋼の色
    expect(h.particles.kept.some((p) => p.r === SOLID_RGB[0] * 1.4 && p.b === SOLID_RGB[2] * 1.4)).toBe(true);
    h.until(() => h.finishes > 0, 800);
    expect(h.sim.score).toBe(target);
  });

  test('飛ばすと、残りは音も粒も出さずに取り除く。最終スコアは見届けたときと同じ', () => {
    const watched = new Harness({ sim: clearingSim(20, undefined, SOLID_ROWS) });
    watched.until(() => watched.finishes > 0, 800);
    for (const framesBeforeSkip of [0, 20, 30]) {
      const h = new Harness({ sim: clearingSim(20, undefined, SOLID_ROWS) });
      h.until(() => h.ended, 600);
      h.run(framesBeforeSkip);
      const sounds = h.rec.count('sfx.solidShatter');
      const particles = h.particles.count;
      expect(h.director.skip()).toBe(true);
      expect(solidCenters(h.sim).length).toBe(0);
      expect(h.particles.count).toBe(particles);
      h.run(300);
      expect(h.rec.count('sfx.solidShatter')).toBe(sounds);
      expect(h.sim.score).toBe(watched.sim.score);
    }
  });

  test('ゲームオーバーでは砕けない', () => {
    const sim = losingSim(SOLID_ROWS);
    const h = new Harness({ sim });
    h.frame();
    dropAllBalls(sim);
    h.until(() => h.finishes > 0, 400);
    h.run(300);
    expect(h.sim.phase).toBe('over');
    expect(solidCenters(h.sim).length).toBe(12);
    expect(h.rec.count('sfx.solidShatter')).toBe(0);
  });
});
