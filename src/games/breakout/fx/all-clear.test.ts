import { describe, expect, test } from 'bun:test';
import { FlashLimiter } from '../../../juice/flash.ts';
import { BALL_RADIUS, tuning } from '../config.ts';
import { clearVisibleRows, ENDLESS, makeSim, placeBall } from '../sim/sim.test-support.ts';
import { ALL_CLEAR_SHOCK_SPEED } from './all-clear.ts';
import { allClearSim, allClearTarget, Harness } from './test-kit.test-support.ts';

/** 全消しのフレームまで進める */
function toAllClear(h: Harness): void {
  h.until(() => h.rec.count('sfx.allClear') > 0, 120);
}

describe('全消し', () => {
  test('最後に壊したブロックの中心から、present の時刻で衝撃波を出し、和音を 1 回鳴らす', () => {
    const h = new Harness({ sim: allClearSim(), presentOffset: 200 });
    const [x, y] = allClearTarget(h.sim);
    toAllClear(h);
    expect(h.fx.shockX).toBe(x);
    expect(h.fx.shockY).toBeCloseTo(y, 9);
    expect(h.fx.shockStart).toBe(h.ft.present);
    expect(h.fx.shockSpeed).toBe(ALL_CLEAR_SHOCK_SPEED);
    expect(h.particles.count).toBeGreaterThan(0);
    h.run(120);
    expect(h.rec.count('sfx.allClear')).toBe(1);
  });

  test('カメラの引きは揺れの一部で、画面の揺れをオフにした倍率では引かない', () => {
    const h = new Harness({ sim: allClearSim() });
    const shakeOn = { shake: 1, pulse: 1, pull: 1, punch: 1, jolt: 1 };
    const shakeOff = { shake: 0, pulse: 0, pull: 1, punch: 0, jolt: 0 };
    const view = { x: 0, y: 0, rotation: 0, zoom: 0 };
    toAllClear(h);
    let minZoom = 1;
    for (let i = 0; i < 30; i++) {
      h.frame();
      minZoom = Math.min(minZoom, h.camera.sample(shakeOn, view).zoom);
      expect(h.camera.sample(shakeOff, view).zoom).toBe(1);
    }
    expect(minZoom).toBeLessThan(0.97);
  });

  test('補充の行が着地したフレームで、叩きつける音を 1 回鳴らす', () => {
    const h = new Harness({ sim: allClearSim() });
    toAllClear(h);
    const clearedAt = h.ft.world;
    expect(h.rec.count('sfx.slam')).toBe(0);
    h.until(() => h.rec.count('sfx.slam') > 0, 60);
    expect(h.ft.world - clearedAt).toBeGreaterThanOrEqual(tuning.endless.refillDropSeconds - 1 / 60);
    expect(h.ft.world - clearedAt).toBeLessThan(tuning.endless.refillDropSeconds + 2 / 60);
    h.run(30);
    expect(h.rec.count('sfx.slam')).toBe(1);
    expect(h.rec.count('sfx.ballsZero')).toBe(0);
  });

  test('補充にペナルティが重なっても、着地の音は 1 回', () => {
    const sim = makeSim(ENDLESS, 5);
    clearVisibleRows(sim);
    // 全消しと同じステップで、最後のボールが奈落へ落ちる
    placeBall(sim, 8.8, -BALL_RADIUS + 0.01, 0, -1);
    const h = new Harness({ sim });
    h.frame();
    expect(h.rec.count('sfx.allClear')).toBe(1);
    expect(h.rec.count('sfx.ballsZero')).toBe(1);
    h.run(60);
    expect(h.rec.count('sfx.slam')).toBe(1);
  });

  test('bloom の強調は、フラッシュリミッターが許可したときだけ', () => {
    const free = new Harness({ sim: allClearSim() });
    toAllClear(free);

    const flashes = new FlashLimiter(3, 1);
    const full = new Harness({ sim: allClearSim(), flashes });
    full.frame();
    // 直前に 3 回使い切っておく
    for (let i = 0; i < 3; i++) expect(flashes.request(full.real)).toBe(true);
    toAllClear(full);
    expect(full.fx.bloomStrength).toBeLessThan(free.fx.bloomStrength);
    expect(full.fx.flash).toBe(0);
    expect(free.fx.flash).toBe(0);
  });
});
