import { describe, expect, test } from 'bun:test';
import { FlashLimiter } from '../../../juice/flash.ts';
import { BlockType, tuning } from '../config.ts';
import { EventKind } from '../sim/events.ts';
import { cellCenterX } from '../sim/blocks.ts';
import { Sim } from '../sim/sim.ts';
import { dropAllBalls, emptyRows, line, placeBall, simConfig, stageMode } from '../sim/sim.test-support.ts';
import { LOOK } from '../view/look.ts';
import { FINALE_HOLD, SHOCK_SPEED } from './finale.ts';
import { createFxState, PRESENT_LONG_AGO } from './fx-state.ts';
import type { FxState } from './fx-state.ts';
import { GAME_OVER_FINISH } from './game-over.ts';
import { clearingSim, Harness, losingSim } from './test-kit.test-support.ts';

/** 大量に起きる（勝敗が決まったら止める）音 */
const STREAM_SOUNDS = ['sfx.paddle', 'sfx.hardHit', 'sfx.breakNote', 'sfx.megaBurst'];

/** 1 フレームに n 個の破壊をイベント列へ足す */
function injectBreaks(n: number, type: number = BlockType.Ball) {
  return (sim: Sim) => {
    for (let i = 0; i < n; i++) sim.events.push(EventKind.BlockBreak, 1 + (i % 7), 10, type, 5 + i);
  };
}

/** ステージクリアのフィナーレが始まるまで進める */
function toEnding(h: Harness): void {
  h.until(() => h.ended, 600);
}

describe('ライフサイクル', () => {
  test('ステージクリア: onEnding と onFinished は 1 回ずつ、この順に呼ばれ、結果は最終スコア', () => {
    const h = new Harness({ sim: clearingSim(5) });
    h.frame();
    expect(h.endings).toBe(0);
    toEnding(h);
    expect(h.endings).toBe(1);
    expect(h.finishes).toBe(0);
    expect(h.sim.phase).toBe('cleared');
    h.until(() => h.finishes > 0, 600);
    // 前のベストがない（0）ので、得点していれば新記録
    expect(h.outcome).toEqual({ cleared: true, score: h.sim.score, newBest: true });
    expect(h.sim.clearBonusRemaining).toBe(0);
    expect(h.rec.indexOf('onEnding')).toBeLessThan(h.rec.indexOf('onFinished'));
    h.run(600);
    expect(h.director.skip()).toBe(false);
    expect(h.endings).toBe(1);
    expect(h.finishes).toBe(1);
  });

  test('結果の newBest は、最終スコアが前のベストを超えたときだけ', () => {
    const probe = new Harness({ sim: clearingSim(5) });
    probe.until(() => probe.finishes > 0, 800);
    const final = probe.sim.score;
    for (const [previousBest, newBest] of [
      [final - 1, true],
      [final, false],
    ] as const) {
      const h = new Harness({ sim: clearingSim(5), previousBest });
      h.until(() => h.finishes > 0, 800);
      expect(h.outcome).toEqual({ cleared: true, score: final, newBest });
    }
  });

  test('ゲームオーバー: onEnding は決着のフレームで、onFinished は実時間 1.4 秒後に 1 回だけ（スローモーション中でも）', () => {
    const h = new Harness({ sim: losingSim() });
    h.run(10);
    dropAllBalls(h.sim);
    h.frame();
    expect(h.sim.phase).toBe('over');
    expect(h.endings).toBe(1);
    expect(h.finishes).toBe(0);
    const start = h.real;
    h.until(() => h.finishes > 0, 600);
    expect(h.outcome).toEqual({ cleared: false, score: h.sim.score, newBest: false });
    expect(h.real - start).toBeGreaterThanOrEqual(GAME_OVER_FINISH - 1e-9);
    expect(h.real - start).toBeLessThan(GAME_OVER_FINISH + 1 / 60 + 1e-9);
    // 世界の時間はスローになっている
    expect(h.worldScale).toBeLessThan(0.2);
    expect(h.director.skip()).toBe(false);
    h.run(600);
    expect(h.finishes).toBe(1);
  });

  test('ゲームオーバーの演出は飛ばせない', () => {
    const h = new Harness({ sim: losingSim() });
    h.frame();
    dropAllBalls(h.sim);
    h.frame();
    expect(h.director.skip()).toBe(false);
    expect(h.finishes).toBe(0);
  });

  test('プレイ中は飛ばせない', () => {
    const h = new Harness({ sim: clearingSim(0) });
    h.frame();
    expect(h.director.skip()).toBe(false);
    expect(h.endings).toBe(0);
    expect(h.finishes).toBe(0);
  });

  test('dispose の後は何もしない。溜めの無音を解く', () => {
    const h = new Harness({ sim: clearingSim(3) });
    toEnding(h);
    expect(h.rec.count('audio.silence')).toBe(1);
    h.director.dispose();
    h.director.dispose();
    expect(h.rec.count('audio.silence.cancel')).toBe(1);
    const before = h.rec.calls.length;
    const snapshot = { ...h.fx, wallHits: h.fx.wallHits.slice() };
    h.run(120);
    expect(h.rec.calls.length).toBe(before);
    expect(h.director.skip()).toBe(false);
    expect({ ...h.fx, wallHits: h.fx.wallHits.slice() }).toEqual(snapshot);
  });
});

describe('音を止める', () => {
  test('破壊音は勝敗が決まったら止まる（ゲームオーバーのスローモーション中も鳴らない）', () => {
    const h = new Harness({ sim: losingSim() });
    h.beforeDirector = injectBreaks(6);
    h.run(60);
    expect(h.rec.count('sfx.breakNote')).toBeGreaterThan(10);
    h.beforeDirector = null;
    dropAllBalls(h.sim);
    h.frame();
    const ending = h.rec.indexOf('onEnding');
    expect(ending).toBeGreaterThan(0);
    h.run(60 * 12);
    for (const name of STREAM_SOUNDS) expect(h.rec.count(name, ending)).toBe(0);
    expect(h.rec.count('sfx.gameOver', ending)).toBe(0);
    expect(h.rec.count('sfx.gameOver')).toBe(1);
  });

  test('破壊音はフィナーレが始まったら止まる', () => {
    const h = new Harness({ sim: clearingSim(20) });
    h.beforeDirector = injectBreaks(6);
    h.until(() => h.ended, 600);
    h.beforeDirector = null;
    const ending = h.rec.indexOf('onEnding');
    h.until(() => h.finishes > 0, 600);
    h.run(200);
    for (const name of STREAM_SOUNDS) expect(h.rec.count(name, ending)).toBe(0);
  });

  test('余韻（afterglow）では音を鳴らさず、BGM の値も変えない', () => {
    const h = new Harness({ sim: clearingSim(8) });
    h.until(() => h.finishes > 0, 800);
    const at = h.rec.calls.length;
    const tier = h.rec.of('bgm.setTier').at(-1)?.args[0];
    h.run(400);
    const after = h.rec.calls.slice(at);
    expect(after.filter((c) => c.name !== 'bgm.setTier')).toEqual([]);
    for (const c of after) expect(c.args[0]).toBe(tier);
  });
});

describe('フィナーレ', () => {
  test('溜めは AudioContext の時刻で 0.3 秒。フレームが止まっても音の時計に合わせて炸裂する', () => {
    const h = new Harness({ sim: clearingSim(4) });
    toEnding(h);
    const startAudio = h.audio.time;
    expect(h.rec.of('audio.silence')[0].args[0]).toBe(FINALE_HOLD);
    expect(h.rec.of('sfx.inhale')[0].args[0]).toBe(FINALE_HOLD);
    // 実時間は上限 0.1 秒で進むが、音の時計は 0.35 秒進んだ
    h.frame(0.1, 0.35);
    expect(h.rec.count('sfx.finaleBurst')).toBe(1);
    expect(h.audio.time - startAudio).toBeGreaterThanOrEqual(FINALE_HOLD);
  });

  test('溜めの間は炸裂しない。炸裂は 1 回だけ', () => {
    const h = new Harness({ sim: clearingSim(4) });
    toEnding(h);
    const start = h.audio.time;
    let burstAt = -1;
    for (let i = 0; i < 120; i++) {
      h.frame();
      if (burstAt < 0 && h.rec.count('sfx.finaleBurst') > 0) burstAt = h.audio.time - start;
    }
    expect(burstAt).toBeGreaterThanOrEqual(FINALE_HOLD - 1e-9);
    expect(burstAt).toBeLessThan(FINALE_HOLD + 1 / 60 + 1e-9);
    expect(h.rec.count('sfx.finaleBurst')).toBe(1);
  });

  test('音の時計が止まっていても、実時間で 0.1 秒の猶予を過ぎたら炸裂し、フィナーレは最後まで進む', () => {
    const h = new Harness({ sim: clearingSim(4) });
    toEnding(h);
    const start = h.real;
    // running のまま、音の時計が進まない
    const frozenAudio = (cond: () => boolean) => {
      for (let i = 0; i < 600 && !cond(); i++) h.frame(1 / 60, 0);
      expect(cond()).toBe(true);
    };
    frozenAudio(() => h.rec.count('sfx.finaleBurst') > 0);
    const t = h.real - start;
    expect(t).toBeGreaterThanOrEqual(FINALE_HOLD + 0.1 - 1e-9);
    expect(t).toBeLessThan(FINALE_HOLD + 0.1 + 1 / 60 + 1e-9);
    frozenAudio(() => h.finishes > 0);
    expect(h.outcome?.cleared).toBe(true);
    expect(h.sim.clearBonusRemaining).toBe(0);
  });

  test('音が鳴っていなければ、溜めは実時間で測る', () => {
    const h = new Harness({ sim: clearingSim(4) });
    h.audio.running = false;
    toEnding(h);
    const start = h.real;
    h.until(() => h.rec.count('sfx.finaleBurst') > 0, 60, 1 / 60);
    const t = h.real - start;
    expect(t).toBeGreaterThanOrEqual(FINALE_HOLD - 1e-9);
    expect(t).toBeLessThan(FINALE_HOLD + 1 / 60 + 1e-9);
  });

  test('溜めの間は吸い込みと縁の絞り込みが強まり、炸裂で衝撃波が present の時刻で始まる', () => {
    const h = new Harness({ sim: clearingSim(4), presentOffset: 500 });
    toEnding(h);
    h.frame();
    expect(h.fx.inhale).toBeGreaterThan(0);
    expect(h.fx.vignette).toBeGreaterThan(0);
    expect(h.fx.shockStart).toBe(PRESENT_LONG_AGO);
    h.until(() => h.rec.count('sfx.finaleBurst') > 0, 60);
    expect(h.fx.shockStart).toBeCloseTo(h.ft.present, 9);
    expect(h.fx.shockStart).toBeGreaterThan(500);
    expect(h.fx.shockSpeed).toBe(SHOCK_SPEED);
    expect(h.fx.focusX).toBe(h.fx.shockX);
    expect(h.fx.focusY).toBe(h.fx.shockY);
  });

  test('衝撃波の半径（世界時間）より外のボールは回収しない', () => {
    const h = new Harness({ sim: clearingSim(60) });
    toEnding(h);
    h.until(() => h.rec.count('sfx.finaleBurst') > 0, 60);
    const burstWorld = h.ft.world;
    const cx = h.fx.shockX;
    const cy = h.fx.shockY;
    const total = h.sim.balls.count;
    expect(total).toBeGreaterThan(20);
    let partial = 0;
    for (let i = 0; i < 90 && h.sim.balls.count > 0; i++) {
      h.frame();
      const r = (h.ft.world - burstWorld) * SHOCK_SPEED;
      const b = h.sim.balls;
      if (h.ft.world - burstWorld >= 1.2) break;
      if (b.count > 0 && b.count < total) partial++;
      for (let k = 0; k < b.count; k++) expect(Math.hypot(b.x[k] - cx, b.y[k] - cy)).toBeGreaterThan(r);
    }
    // 一度にではなく、衝撃波の広がりに合わせて少しずつ回収した
    expect(partial).toBeGreaterThan(2);
    expect(h.sim.balls.count).toBe(0);
  });

  test('見届けても飛ばしても、最終スコアは同じ（クリアの時点のボールの数だけ加算）', () => {
    const extra = 40;
    const watched = new Harness({ sim: clearingSim(extra) });
    toEnding(watched);
    const atClear = watched.sim.score;
    const balls = watched.sim.clearBonusRemaining;
    expect(balls).toBe(extra + 1);
    watched.until(() => watched.finishes > 0, 800);
    expect(watched.sim.score).toBe(atClear + balls * tuning.score.pointsClearBall);
    expect(watched.rec.count('sfx.resolveChord')).toBe(1);
    expect(watched.rec.count('sfx.bonusNote')).toBeGreaterThan(0);

    for (const framesBeforeSkip of [0, 10, 30, 45]) {
      const skipped = new Harness({ sim: clearingSim(extra) });
      toEnding(skipped);
      skipped.run(framesBeforeSkip);
      if (skipped.finishes > 0) continue;
      expect(skipped.director.skip()).toBe(true);
      expect(skipped.sim.score).toBe(watched.sim.score);
      expect(skipped.finishes).toBe(1);
    }
  });

  test('スキップは終端: 炸裂・和音・届く音・フラッシュ・振動は後から出ない', () => {
    const h = new Harness({ sim: clearingSim(30) });
    toEnding(h);
    h.frame();
    const before = h.rec.calls.length;
    const vib = h.vibrations.length;
    expect(h.director.skip()).toBe(true);
    expect(h.director.skip()).toBe(false);
    expect(h.rec.count('audio.silence.cancel')).toBe(1);
    expect(h.finishes).toBe(1);
    h.run(600);
    const after = h.rec.names(before);
    expect(after.filter((n) => n.startsWith('sfx.'))).toEqual([]);
    expect(h.vibrations.length).toBe(vib);
    expect(h.fx.flash).toBe(0);
    expect(h.fx.shockStart).toBe(PRESENT_LONG_AGO);
    expect(h.fx.inhale).toBe(0);
    expect(h.fx.vignette).toBe(0);
    expect(h.finishes).toBe(1);
  });

  test('回収中にスキップしても、まだ届いていない光の分も含めて加算する', () => {
    const watched = new Harness({ sim: clearingSim(50) });
    toEnding(watched);
    const target = watched.sim.score + watched.sim.clearBonusRemaining * tuning.score.pointsClearBall;
    watched.until(() => watched.rec.count('sfx.bonusNote') > 0, 400);
    expect(watched.director.skip()).toBe(true);
    expect(watched.sim.score).toBe(target);
    expect(watched.sim.balls.count).toBe(0);
  });
});

describe('フラッシュリミッター', () => {
  test('炸裂のフラッシュと bloom のブーストは、リミッターが許可したときだけ', () => {
    const free = new Harness({ sim: clearingSim(2) });
    toEnding(free);
    free.until(() => free.rec.count('sfx.finaleBurst') > 0, 60);
    expect(free.fx.flash).toBeCloseTo(LOOK.finaleFlash * Math.exp(-9 / 60), 9);

    const flashes = new FlashLimiter(3, 1);
    const full = new Harness({ sim: clearingSim(2), flashes });
    toEnding(full);
    // 直前に 3 回使い切っておく
    for (let i = 0; i < 3; i++) expect(flashes.request(full.real)).toBe(true);
    full.until(() => full.rec.count('sfx.finaleBurst') > 0, 60);
    expect(full.fx.flash).toBe(0);
    expect(full.fx.bloomStrength).toBeLessThan(free.fx.bloomStrength);
  });

  test('フラッシュは FLASH_EPSILON 未満で 0 にする', () => {
    const h = new Harness({ sim: clearingSim(2) });
    toEnding(h);
    h.until(() => h.rec.count('sfx.finaleBurst') > 0, 60);
    expect(h.fx.flash).toBeGreaterThan(0);
    h.run(120);
    expect(h.fx.flash).toBe(0);
  });
});

describe('振動', () => {
  test('パドルで打っても振動しない。ボール 0・Peak・フィナーレだけ', () => {
    const h = new Harness({ sim: clearingSim(0), previousBest: 1e9 });
    h.beforeDirector = (sim) => {
      sim.events.push(EventKind.PaddleHit, 4, 1.8, 0.3, 0);
      sim.events.push(EventKind.Launch, 4, 1.8, 0, 0);
      sim.events.push(EventKind.WallHit, 0, 5, -1, 0);
      sim.events.push(EventKind.HardHit, 3, 12, 1, 2);
    };
    h.run(5);
    expect(h.vibrations).toEqual([]);
    expect(h.rec.count('sfx.paddle')).toBeGreaterThan(0);
    h.beforeDirector = null;
    h.until(() => h.finishes > 0, 800);
    expect(h.vibrations).toEqual([[40, 40, 120], 80]);
  });

  test('ボール 0 とゲームオーバー', () => {
    const h = new Harness({ sim: losingSim(), previousBest: 1e9 });
    h.frame();
    dropAllBalls(h.sim);
    h.frame();
    expect(h.vibrations).toEqual([[30, 40, 60]]);
    h.run(200);
    expect(h.vibrations).toEqual([[30, 40, 60]]);
  });
});

describe('Peak と HUD のベスト', () => {
  test('プレイ中に自己ベストを超えた瞬間に 1 回だけ Peak を出す', () => {
    // 2 個のブロックのうち 1 個を、真上へ飛ぶボールが壊す
    const sim = new Sim({ mode: stageMode(emptyRows(10).concat([line(2, 'o'), line(6, 'o')])), seed: 1, config: simConfig() });
    placeBall(sim, cellCenterX(2), 3, 0, 1);
    const h = new Harness({ sim, previousBest: 5 });
    h.until(() => sim.score > 0, 300);
    expect(sim.phase).toBe('playing');
    expect(h.rec.count('sfx.peakChord')).toBe(1);
    expect(h.rec.of('sfx.peakChord')[0].args).toEqual([3]);
    expect(h.vibrations).toEqual([45]);
    h.run(300);
    expect(h.rec.count('sfx.peakChord')).toBe(1);
    expect(h.vibrations.filter((v) => v === 45)).toEqual([45]);
  });

  test('記録がない（前のベストが 0）ときは、得点すると HUD の NEW! は点くが、Peak の演出は出さない', () => {
    const sim = new Sim({ mode: stageMode(emptyRows(10).concat([line(2, 'o'), line(6, 'o')])), seed: 1, config: simConfig() });
    placeBall(sim, cellCenterX(2), 3, 0, 1);
    const h = new Harness({ sim, previousBest: 0 });
    h.until(() => sim.score > 0, 300);
    h.run(120);
    const hud = { score: 0, chain: 0, multiplier: 0, best: 0, newBest: false, lives: 0 };
    h.director.hud(hud);
    expect(sim.score).toBeGreaterThan(0);
    expect(hud.newBest).toBe(true);
    expect(hud.best).toBe(sim.score);
    expect(h.rec.count('sfx.peakChord')).toBe(0);
    expect(h.vibrations.filter((v) => v === 45)).toEqual([]);
  });

  test('ボールボーナスでベストを超えたら、HUD の NEW! は点くが Peak は出さない', () => {
    const extra = 30;
    const probe = new Harness({ sim: clearingSim(extra) });
    toEnding(probe);
    const scoreAtClear = probe.sim.score;

    const h = new Harness({ sim: clearingSim(extra), previousBest: scoreAtClear + 5 });
    const hud = { score: 0, chain: 0, multiplier: 0, best: 0, newBest: false, lives: 0 };
    toEnding(h);
    h.director.hud(hud);
    expect(hud.newBest).toBe(false);
    expect(hud.best).toBe(scoreAtClear + 5);
    h.until(() => h.finishes > 0, 800);
    h.director.hud(hud);
    expect(hud.newBest).toBe(true);
    expect(hud.best).toBe(h.sim.score);
    expect(h.rec.count('sfx.peakChord')).toBe(0);
  });
});

describe('FxState', () => {
  const SCALARS = Object.keys(createFxState(false, 0, 0)).filter((k) => k !== 'endless' && k !== 'wallHits') as (keyof FxState)[];

  function poison(fx: FxState): void {
    const rec = fx as unknown as Record<string, unknown>;
    for (const k of SCALARS) rec[k] = Number.NaN;
    fx.wallHits.fill(Number.NaN);
  }

  function expectWritten(fx: FxState): void {
    for (const k of SCALARS) expect({ k, v: Number.isNaN(fx[k] as number) }).toEqual({ k, v: false });
    for (const v of fx.wallHits) expect(Number.isNaN(v)).toBe(false);
  }

  test('どのフレームでも endless 以外のすべての値を書く（プレイ中・フィナーレ・余韻）', () => {
    const h = new Harness({ sim: clearingSim(20) });
    h.beforeDirector = (sim) => sim.events.push(EventKind.WallHit, 0, 7, 1, 0);
    for (let i = 0; i < 400; i++) {
      poison(h.fx);
      h.frame();
      expectWritten(h.fx);
    }
    expect(h.finishes).toBe(1);
  });

  test('新しい FxState と最初のフレームは、何も起きていない状態を書く', () => {
    const h = new Harness({ sim: losingSim() });
    const fresh = createFxState(false, 0, 0);
    h.frame();
    const fx = h.fx;
    expect(fx.inhale).toBe(0);
    expect(fx.vignette).toBe(0);
    expect(fx.flash).toBe(0);
    expect(fx.danger).toBe(0);
    expect(fx.glow).toBe(0);
    expect(fx.tier).toBe(0);
    expect(fx.hue).toBe(0);
    expect(fx.intensity).toBe(0);
    expect(fx.beat).toBe(1);
    expect([fx.focusX, fx.focusY, fx.shockX, fx.shockY, fx.shockStart, fx.shockSpeed]).toEqual([
      fresh.focusX,
      fresh.focusY,
      fresh.shockX,
      fresh.shockY,
      fresh.shockStart,
      fresh.shockSpeed,
    ]);
    expect(Array.from(fx.wallHits)).toEqual(Array.from(fresh.wallHits));
    expect([fx.paddleSquashX, fx.paddleSquashY, fx.paddleFlash]).toEqual([1, 1, 0]);
    expect(fx.bloomStrength).toBeCloseTo(LOOK.bloom.base, 12);
    expect(fx.bloomRadius).toBeCloseTo(LOOK.bloom.radius, 12);
  });

  test('壁の揺れは present の時刻で記録し、1 フレームに 2 件まで', () => {
    const h = new Harness({ sim: losingSim(), presentOffset: 300 });
    h.beforeDirector = (sim) => {
      for (let i = 0; i < 5; i++) sim.events.push(EventKind.WallHit, 0, 3 + i, i % 2 ? 1 : -1, 0);
      sim.events.push(EventKind.WallHit, 4, 16, 0, 1);
    };
    h.frame();
    const w = h.fx.wallHits;
    expect([w[0], w[1], w[2]]).toEqual([3, Math.fround(h.ft.present), -1]);
    expect([w[4], w[5], w[6]]).toEqual([4, Math.fround(h.ft.present), 1]);
    expect(w[9]).toBe(PRESENT_LONG_AGO);
    expect(w[3]).toBeCloseTo(Math.min(1.4, 0.7 + 6 * 0.02), 6);
  });
});

describe('音の集約', () => {
  test('ボール大量ブロックの音は 1 フレームに 1 回。弾ける見た目は 3 個まで', () => {
    const h = new Harness({ sim: losingSim() });
    h.beforeDirector = injectBreaks(5, BlockType.Mega);
    h.frame();
    expect(h.rec.count('sfx.megaBurst')).toBe(1);
    h.beforeDirector = null;
    h.frame();
    expect(h.rec.count('sfx.megaBurst')).toBe(1);
  });

  test('ハードの音は間引く（最短 0.05 秒）', () => {
    const h = new Harness({ sim: losingSim() });
    h.beforeDirector = (sim) => {
      for (let i = 0; i < 3; i++) sim.events.push(EventKind.HardHit, 3, 12, 1, 2);
    };
    h.run(60);
    const n = h.rec.count('sfx.hardHit');
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThanOrEqual(Math.ceil(1 / 0.05) + 1);
  });

});

describe('割り当て', () => {
  test('粒と破片の発生条件は、同じオブジェクトを使い回す', () => {
    const h = new Harness({ sim: losingSim() });
    h.beforeDirector = (sim) => {
      injectBreaks(20)(sim);
      injectBreaks(2, BlockType.Mega)(sim);
      sim.events.push(EventKind.HardHit, 3, 12, 1, 2);
      sim.events.push(EventKind.PaddleHit, 4, 1.8, 0.3, 0);
      sim.events.push(EventKind.Overflow, 4, 5, 0, 0);
    };
    h.run(30);
    expect(h.particles.count).toBeGreaterThan(1000);
    expect(h.particles.specs.size).toBe(1);
    expect(h.debris.count).toBeGreaterThan(100);
    expect(h.debris.specs.size).toBe(1);
  });

  test('粒の時刻は present の時間軸', () => {
    const h = new Harness({ sim: losingSim(), presentOffset: 1000 });
    h.beforeDirector = injectBreaks(1);
    h.frame();
    expect(h.particles.times.length).toBeGreaterThan(0);
    for (const t of h.particles.times) expect(t).toBe(h.ft.present);
  });
});
