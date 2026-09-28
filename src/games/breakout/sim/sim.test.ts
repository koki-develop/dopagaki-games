import { describe, expect, test } from 'bun:test';
import {
  BALL_CAP,
  BALL_RADIUS,
  BLOCK_H,
  BLOCK_INSET_X,
  BLOCK_INSET_Y,
  BLOCK_W,
  BlockType,
  CELL_H,
  COLS,
  DANGER_Y,
  FIELD_H,
  FIELD_W,
  PADDLE_Y,
  STEP_DT,
  tuning,
} from '../config.ts';
import type { Tuning } from '../config.ts';
import { BlockField, cellCenterX, cellLeft, colAtX } from './blocks.ts';
import { EventKind, Signal } from './events.ts';
import { Sim, paddleRange } from './sim.ts';
import {
  ENDLESS,
  MIXED,
  PLAIN,
  autoplayInput,
  clearBalls,
  clearVisibleRows,
  emptyRows,
  hold,
  line,
  makeSim,
  placeBall,
  setBlock,
  stageMode,
} from './sim.test-support.ts';

const R = BALL_RADIUS;
const EPS = 1e-9;
const DEG = Math.PI / 180;

function runSteps(sim: Sim, steps: number, each?: () => void): void {
  for (let i = 0; i < steps; i++) {
    sim.step(hold(sim));
    each?.();
    sim.events.clear();
  }
}

/** 一番下の行の下端が y 以下で、y にいちばん近くなる初期の行数（エンドレス） */
const rowsReaching = (y: number) => Math.ceil((FIELD_H - y) / CELL_H);

/**
 * ボールがパドルに乗ったままゲームオーバーになったエンドレスの sim。
 * 一番下の行を危険ラインのすぐ上に置き、打ち上げたボールを取りこぼして、ペナルティの降下で危険ラインに届かせる。
 */
function gameOverWhileAttached(): Sim {
  const rows = rowsReaching(DANGER_Y) - 1;
  const sim = makeSim(ENDLESS, 1, (t) => {
    t.endless.initialRows = rows;
    t.blocks.ballsFromBall = 0;
    t.blocks.ballsFromHard = 0;
    t.blocks.ballsFromMega = 0;
  });
  expect(sim.blocks.lowestLiveBlockBottom()).toBeGreaterThan(DANGER_Y);
  // パドルを列 6 の真下で止めてから真上に打ち、その後パドルを左端へ逃がす
  const x = cellCenterX(6);
  for (let i = 0; i < 120; i++) sim.step({ paddleTargetX: x, launch: false });
  sim.step({ paddleTargetX: x, launch: true });
  for (let i = 0; i < 2000 && sim.phase === 'playing'; i++) {
    sim.step({ paddleTargetX: 0, launch: false });
    sim.events.clear();
  }
  expect(sim.phase).toBe('over');
  expect(sim.attached).toBe(true);
  sim.events.clear();
  return sim;
}

const degOf = (dx: number, dy: number) => Math.atan2(dy, dx) / DEG;

function assertBallInvariants(sim: Sim): void {
  const b = sim.balls;
  const minSin = Math.sin(sim.config.ball.minDegFromHorizontal * DEG);
  for (let i = 0; i < b.count; i++) {
    expect(b.x[i]).toBeGreaterThanOrEqual(R - EPS);
    expect(b.x[i]).toBeLessThanOrEqual(FIELD_W - R + EPS);
    expect(b.y[i]).toBeLessThanOrEqual(FIELD_H - R + EPS);
    expect(Math.abs(Math.hypot(b.dx[i], b.dy[i]) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(b.dy[i])).toBeGreaterThanOrEqual(minSin - 1e-9);
  }
}

/** どのボールの中心も、生きているブロックの矩形の内側にないこと */
function assertNoBallInsideBlocks(sim: Sim): void {
  const b = sim.balls;
  const f = sim.blocks;
  for (let i = 0; i < b.count; i++) {
    const row = f.rowAtY(b.y[i]);
    const col = colAtX(b.x[i]);
    if (row < 0 || col < 0 || col >= COLS) continue;
    const idx = f.slotOf(row) * COLS + col;
    if (f.type[idx] === BlockType.Empty) continue;
    const bx0 = cellLeft(col) + BLOCK_INSET_X;
    const by0 = f.rowBottomY(row) + BLOCK_INSET_Y;
    const inside = b.x[i] > bx0 && b.x[i] < bx0 + BLOCK_W && b.y[i] > by0 && b.y[i] < by0 + BLOCK_H;
    expect(inside).toBe(false);
  }
}

describe('発射', () => {
  test('静止したパドルからは真上に打ち出す', () => {
    const sim = makeSim(PLAIN);
    expect(sim.attached).toBe(true);
    sim.step(hold(sim, true));
    expect(sim.attached).toBe(false);
    expect(sim.balls.count).toBe(1);
    expect(sim.events.counts[EventKind.Launch]).toBe(1);
    expect(sim.balls.dx[0]).toBeCloseTo(0, 12);
    expect(sim.balls.dy[0]).toBeCloseTo(1, 12);
    sim.events.clear();
    sim.step(hold(sim, true));
    expect(sim.balls.count).toBe(1);
    expect(sim.events.counts[EventKind.Launch]).toBe(0);
  });

  test('動かしながら離すと、移動方向へ最大 launchTiltMaxDeg まで傾く', () => {
    const sim = makeSim(PLAIN);
    for (let i = 0; i < 40; i++) sim.step({ paddleTargetX: 1 + i * 0.16, launch: false });
    sim.step(hold(sim, true));
    const deg = (Math.atan2(sim.balls.dx[0], sim.balls.dy[0]) * 180) / Math.PI;
    expect(deg).toBeCloseTo(sim.config.paddle.launchTiltMaxDeg, 6);
  });

  test('決着した後は、ボールがパドルに乗っていても打ち出さない', () => {
    const sim = gameOverWhileAttached();
    sim.step(hold(sim, true));
    expect(sim.balls.count).toBe(0);
    expect(sim.attached).toBe(true);
    expect(sim.events.counts[EventKind.Launch]).toBe(0);
  });

  test('有限でないパドルの目標は無視する', () => {
    const sim = makeSim(ENDLESS);
    sim.step({ paddleTargetX: 3, launch: false });
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      sim.step({ paddleTargetX: bad, launch: false });
      expect(sim.paddleX).toBe(3);
    }
    sim.step({ paddleTargetX: Number.NaN, launch: true });
    expect(sim.balls.count).toBe(1);
    expect(Number.isFinite(sim.balls.dx[0])).toBe(true);
    expect(Number.isFinite(sim.balls.y[0])).toBe(true);
  });

  test('パドルの目標は壁の内側（paddleRange）に収める', () => {
    const sim = makeSim(ENDLESS);
    const range = paddleRange(sim.config);
    expect(range.min).toBe(sim.paddleWidth / 2);
    expect(range.max).toBe(FIELD_W - sim.paddleWidth / 2);
    sim.step({ paddleTargetX: -100, launch: false });
    expect(sim.paddleX).toBe(range.min);
    sim.step({ paddleTargetX: 100, launch: false });
    expect(sim.paddleX).toBe(range.max);
    sim.step({ paddleTargetX: 3, launch: false });
    expect(sim.paddleX).toBe(3);
  });
});

describe('壁と天井', () => {
  test('ボールはフィールドの外に出ず、向きは単位ベクトルで、水平に近づきすぎない', () => {
    const sim = makeSim(stageMode(emptyRows(2).concat([line(0, 'o')])), 7);
    const minSin = Math.sin(sim.config.ball.minDegFromHorizontal * DEG);
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2 + 0.1;
      if (Math.abs(Math.sin(a)) < minSin) continue;
      placeBall(sim, 0.5 + (k % 8), 6 + (k % 5), Math.cos(a), Math.sin(a));
    }
    expect(sim.balls.count).toBeGreaterThan(20);
    runSteps(sim, 2000, () => assertBallInvariants(sim));
  });

  test('真横に近い向きのボールは、壁で反射した時点で水平から minDeg まで起こされる', () => {
    const sim = makeSim(stageMode(emptyRows(2).concat([line(0, 'o')])), 7);
    placeBall(sim, 8.5, 8, 1, 0.01);
    runSteps(sim, 10);
    const deg = (Math.atan2(Math.abs(sim.balls.dy[0]), Math.abs(sim.balls.dx[0])) * 180) / Math.PI;
    expect(sim.balls.dx[0]).toBeLessThan(0);
    expect(sim.balls.dy[0]).toBeGreaterThan(0);
    expect(deg).toBeCloseTo(sim.config.ball.minDegFromHorizontal, 9);
  });

  test('天井で反射する', () => {
    const sim = makeSim(stageMode(emptyRows(1).concat([line(0, 'o')])));
    placeBall(sim, 5, FIELD_H - 0.5, 0, 1);
    let hitCeiling = false;
    runSteps(sim, 30, () => {
      for (let i = 0; i < sim.events.length; i++) {
        if (sim.events.kind[i] === EventKind.WallHit && sim.events.b[i] === 1) hitCeiling = true;
      }
    });
    expect(hitCeiling).toBe(true);
    expect(sim.balls.dy[0]).toBeLessThan(0);
  });
});

describe('ブロック', () => {
  test('最高速でもボールはブロックをすり抜けず、中に入り込まない', () => {
    const sim = makeSim(MIXED, 3, (t) => {
      t.ball.speedStart = t.ball.speedMax;
      t.blocks.ballsFromBall = 0;
      t.blocks.ballsFromHard = 0;
      t.blocks.ballsFromMega = 0;
    });
    for (let k = 0; k < 30; k++) {
      const a = 0.4 + (k / 30) * (Math.PI - 0.8);
      placeBall(sim, 0.3 + (k % 28) * 0.3, 2.5, Math.cos(a), Math.sin(a));
    }
    runSteps(sim, 1500, () => {
      assertBallInvariants(sim);
      assertNoBallInsideBlocks(sim);
    });
  });

  test('下から当たったボールは下へ跳ね返り、ブロックは壊れてボールが出る', () => {
    const rows = emptyRows(10).concat([line(4, 'o')]);
    const sim = makeSim(stageMode(rows.concat([line(COLS - 1, 'o')])));
    const f = sim.blocks;
    const cy = f.centerY(1);
    placeBall(sim, cellCenterX(4), cy - 1, 0, 1);
    let broke = false;
    runSteps(sim, 60, () => {
      const ev = sim.events;
      for (let i = 0; i < ev.length; i++) {
        if (ev.kind[i] !== EventKind.BlockBreak) continue;
        broke = true;
        // 当たった点は、ブロックの下の辺の上
        expect(ev.c[i]).toBeCloseTo(cellCenterX(4), 5);
        expect(ev.d[i]).toBeCloseTo(cy - BLOCK_H / 2, 5);
      }
    });
    expect(broke).toBe(true);
    expect(f.liveCount).toBe(1);
    // 反射したボールと、ブロックから出たボールの 2 個
    expect(sim.balls.count).toBe(2);
    expect(sim.balls.dy[0]).toBeLessThan(0);
  });

  test('ブロックの種類ごとに出るボールの数と得点が違う', () => {
    const cases: Array<[string, number, number]> = [
      ['o', tuning.blocks.ballsFromBall, tuning.score.pointsBall],
      ['3', tuning.blocks.ballsFromHard, tuning.score.pointsHardPerHp * 3],
      ['M', tuning.blocks.ballsFromMega, tuning.score.pointsMega],
    ];
    for (const [ch, balls, points] of cases) {
      const sim = makeSim(stageMode(emptyRows(10).concat([line(0, ch), line(COLS - 1, 'o')])));
      const cy = sim.blocks.centerY(1);
      const hp = ch === '3' ? 3 : 1;
      let breaks = 0;
      let hardHits = 0;
      for (let h = 0; h < hp; h++) {
        clearBalls(sim);
        placeBall(sim, cellCenterX(0), cy - 1, 0, 1);
        runSteps(sim, 60, () => {
          for (let i = 0; i < sim.events.length; i++) {
            if (sim.events.kind[i] === EventKind.BlockBreak) breaks++;
            if (sim.events.kind[i] === EventKind.HardHit) hardHits++;
          }
        });
      }
      expect(breaks).toBe(1);
      expect(hardHits).toBe(hp - 1);
      // 反射したボール 1 個 + 出てきたボール
      expect(sim.balls.count).toBe(1 + balls);
      // 1 個目の破壊は chain 1 なので、倍率は 1 + 1 / chainDivisor
      expect(sim.score).toBe(Math.round(points * (1 + 1 / tuning.score.chainDivisor)));
    }
  });

  test('ボールの上限を超えた分はスコアに変換する', () => {
    const sim = makeSim(stageMode(emptyRows(10).concat([line(0, 'M'), line(COLS - 1, 'o')])));
    const cy = sim.blocks.centerY(1);
    placeBall(sim, cellCenterX(0), cy - 1, 0, 1);
    while (sim.balls.count < BALL_CAP - 2) placeBall(sim, 8.5, 3, 0.5, Math.sqrt(0.75));
    const before = sim.balls.count;
    let overflow = 0;
    runSteps(sim, 60, () => {
      overflow += sim.events.counts[EventKind.Overflow];
    });
    expect(sim.balls.count).toBeLessThanOrEqual(BALL_CAP);
    expect(before).toBe(BALL_CAP - 2);
    expect(overflow).toBe(tuning.blocks.ballsFromMega - 2);
    const mult = 1 + 1 / tuning.score.chainDivisor;
    expect(sim.score).toBe(Math.round(tuning.score.pointsMega * mult) + overflow * Math.round(tuning.score.pointsOverflow * mult));
  });

  test('0.5 秒以内に壊し続けると chain が伸び、倍率が上がる', () => {
    const sim = makeSim(PLAIN, 1, (t) => {
      t.blocks.ballsFromBall = 0;
    });
    const f = sim.blocks;
    let lastChain = 0;
    for (let col = 0; col < 5; col++) {
      // 一番下の行のブロックを、下から順番に叩く
      clearBalls(sim);
      placeBall(sim, cellCenterX(col), f.centerY(0) - 0.6, 0, 1);
      let chain = 0;
      runSteps(sim, 12, () => {
        for (let i = 0; i < sim.events.length; i++) {
          if (sim.events.kind[i] === EventKind.BlockBreak) chain = sim.events.b[i];
        }
      });
      expect(chain).toBe(lastChain + 1);
      lastChain = chain;
    }
    expect(sim.chain).toBe(5);
    expect(sim.chainMultiplier).toBeCloseTo(1 + 5 / tuning.score.chainDivisor, 12);
    runSteps(sim, Math.ceil(tuning.score.chainWindow / STEP_DT) + 2);
    expect(sim.chain).toBe(0);
  });

  test('凹んだ角に入ったボールは、1 ステップで同じブロックに 2 回当たらず、どの面からも離れる', () => {
    const rows = ['............', '............', '.....9......', '....9.......', '...........o'];
    const patch = (t: Tuning) => {
      t.ball.speedStart = 13;
      t.blocks.ballsFromHard = 0;
    };
    // 再現する配置: 左の列 4 の右面と、上の列 5 の下面が作る凹んだ角
    const hp = (sim: Sim, row: number, col: number) => sim.blocks.hp[sim.blocks.slotOf(row) * COLS + col];
    const repro = makeSim(stageMode(rows), 1, patch);
    placeBall(repro, 3.952, 14.61, Math.cos(96.2 * DEG), Math.sin(96.2 * DEG));
    for (let s = 0; s < 20; s++) {
      const before = hp(repro, 1, 4);
      repro.step(hold(repro));
      repro.events.clear();
      expect(before - hp(repro, 1, 4)).toBeLessThanOrEqual(1);
    }
    // 角の近くの位置と向きを総当たりで調べる
    let hits = 0;
    for (let ai = 0; ai < 60; ai++) {
      for (let xi = 0; xi < 30; xi++) {
        const sim = makeSim(stageMode(rows), 1, patch);
        const x = cellLeft(4) + BLOCK_INSET_X + BLOCK_W + 0.1 + 0.3 * (xi / 30);
        const y = sim.blocks.rowBottomY(1) + 0.05;
        const a = (95 + ai * (80 / 60)) * DEG;
        placeBall(sim, x, y, Math.cos(a), Math.sin(a));
        for (let s = 0; s < 20; s++) {
          const a4 = hp(sim, 1, 4);
          const a5 = hp(sim, 2, 5);
          sim.step(hold(sim));
          hits += sim.events.counts[EventKind.HardHit];
          sim.events.clear();
          expect(a4 - hp(sim, 1, 4)).toBeLessThanOrEqual(1);
          expect(a5 - hp(sim, 2, 5)).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(hits).toBeGreaterThan(100);
  });

  test('壊れないブロックは跳ね返すだけで、壊れず、得点もボールも出さない。当たった点と跳ね返った向きを知らせる', () => {
    const sim = makeSim(stageMode(emptyRows(10).concat([line(4, 'X'), line(COLS - 1, 'o')])));
    const f = sim.blocks;
    const idx = f.slotOf(1) * COLS + 4;
    placeBall(sim, cellCenterX(4), f.centerY(1) - 1, 0, 1);
    const hits: number[][] = [];
    runSteps(sim, 60, () => {
      const ev = sim.events;
      expect(ev.counts[EventKind.BlockBreak] + ev.counts[EventKind.HardHit]).toBe(0);
      for (let i = 0; i < ev.length; i++) if (ev.kind[i] === EventKind.SolidHit) hits.push([ev.x[i], ev.y[i], ev.a[i], ev.b[i]]);
    });
    expect(hits.length).toBe(1);
    const [x, y, dx, dy] = hits[0];
    // イベントの位置は Float32Array に入る
    expect(x).toBeCloseTo(cellCenterX(4), 5);
    expect(y).toBeCloseTo(f.rowBottomY(1) + BLOCK_INSET_Y, 5);
    expect([dx, dy]).toEqual([0, -1]);
    expect(f.type[idx]).toBe(BlockType.Solid);
    expect(f.hitAt[idx]).toBeGreaterThan(0);
    expect([f.liveCount, f.breakableCount]).toEqual([2, 1]);
    expect(sim.score).toBe(0);
    expect(sim.chain).toBe(0);
    expect(sim.balls.count).toBe(1);
    expect(sim.balls.dy[0]).toBeLessThan(0);
  });

  test('壊れないブロックの横の面に当たったときは、その面の上の点を知らせる', () => {
    const sim = makeSim(stageMode(emptyRows(10).concat([line(4, 'X'), line(COLS - 1, 'o')])));
    const f = sim.blocks;
    const left = cellLeft(4) + BLOCK_INSET_X;
    const a = 20 * DEG;
    placeBall(sim, left - 0.5, f.centerY(1) - 0.5 * Math.tan(a), Math.cos(a), Math.sin(a));
    const hits: number[][] = [];
    runSteps(sim, 30, () => {
      const ev = sim.events;
      for (let i = 0; i < ev.length; i++) if (ev.kind[i] === EventKind.SolidHit) hits.push([ev.x[i], ev.y[i], ev.a[i]]);
    });
    expect(hits.length).toBe(1);
    const [x, y, dx] = hits[0];
    expect(x).toBeCloseTo(left, 5);
    expect(y).toBeGreaterThan(f.rowBottomY(1) + BLOCK_INSET_Y);
    expect(y).toBeLessThan(f.rowBottomY(1) + BLOCK_INSET_Y + BLOCK_H);
    expect(dx).toBeLessThan(0);
  });

  test('壊れないブロックが入り組んでいても、最高速のボールはすり抜けず、中に入り込まず、壊れないブロックは残る', () => {
    const rows = [
      'X..X..X..X..',
      '.X..X..X..X.',
      '..X..X..X..X',
      '............',
      'XXX.XXXX.XXX',
      '............',
      '.XX..XX..XX.',
      '.X........X.',
      '...........9',
    ];
    const sim = makeSim(stageMode(rows), 5, (t) => {
      t.ball.speedStart = t.ball.speedMax;
    });
    const f = sim.blocks;
    const solids: number[] = [];
    for (let i = 0; i < f.type.length; i++) if (f.type[i] === BlockType.Solid) solids.push(i);
    for (let k = 0; k < 40; k++) {
      const a = 0.35 + (k / 40) * (Math.PI - 0.7);
      placeBall(sim, 0.3 + ((k * 0.37) % 8.4), 13 - (k % 5) * 0.4, Math.cos(a), Math.sin(a));
    }
    let solidHits = 0;
    runSteps(sim, 3000, () => {
      solidHits += sim.events.counts[EventKind.SolidHit];
      assertBallInvariants(sim);
      assertNoBallInsideBlocks(sim);
    });
    // クリアするとボールが止まるので、最後まで当たり続けるよう、壊せるブロックは壊れずに残る硬さにしてある
    expect(sim.phase).toBe('playing');
    expect(solidHits).toBeGreaterThan(200);
    for (const i of solids) expect(f.type[i]).toBe(BlockType.Solid);
  });

  test('ブロックに当たると version が増える', () => {
    const sim = makeSim(stageMode(emptyRows(10).concat([line(4, '3'), line(COLS - 1, 'o')])));
    const v0 = sim.blocks.version;
    placeBall(sim, cellCenterX(4), sim.blocks.centerY(1) - 0.5, 0, 1);
    let hit = false;
    runSteps(sim, 30, () => {
      if (sim.events.counts[EventKind.HardHit] > 0) hit = true;
    });
    expect(hit).toBe(true);
    expect(sim.blocks.version).toBeGreaterThan(v0);
  });
});

describe('分裂', () => {
  /** ch のブロックを下から壊し、壊した瞬間に出てきたボールの角度（度）と、跳ね返ったボールの角度を返す */
  function burst(ch: string, seed: number, hits: number): { center: number; spawned: number[] } {
    const sim = makeSim(stageMode(emptyRows(10).concat([line(5, ch), line(COLS - 1, 'o')])), seed);
    const cy = sim.blocks.centerY(1);
    for (let h = 0; h < hits; h++) {
      clearBalls(sim);
      placeBall(sim, cellCenterX(5), cy - 0.6, Math.sin(10 * DEG), Math.cos(10 * DEG));
      for (let s = 0; s < 60; s++) {
        sim.step(hold(sim));
        const broke = sim.events.counts[EventKind.BlockBreak] > 0;
        sim.events.clear();
        if (!broke) continue;
        const b = sim.balls;
        const spawned: number[] = [];
        for (let i = 1; i < b.count; i++) spawned.push(degOf(b.dx[i], b.dy[i]));
        return { center: degOf(b.dx[0], b.dy[0]), spawned };
      }
    }
    throw new Error('block did not break');
  }

  const minDy = Math.sin(tuning.ball.minDegFromHorizontal * DEG) - 1e-9;

  test('ボール入りは、跳ね返った向きを中心に ±spreadDeg の扇へ 1 個出す', () => {
    let sum = 0;
    const n = 200;
    for (let seed = 1; seed <= n; seed++) {
      const { center, spawned } = burst('o', seed, 1);
      expect(spawned.length).toBe(1);
      const off = spawned[0] - center;
      expect(Math.abs(off)).toBeLessThanOrEqual(tuning.blocks.spreadDeg + 1e-9);
      expect(Math.abs(Math.sin(spawned[0] * DEG))).toBeGreaterThanOrEqual(minDy);
      sum += off;
    }
    expect(Math.abs(sum / n)).toBeLessThan(3);
  });

  test('ハードは扇の左右の半分に 1 個ずつ出す', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { center, spawned } = burst('2', seed, 2);
      expect(spawned.length).toBe(2);
      const offs = spawned.map((d) => d - center);
      expect(offs[0]).toBeGreaterThanOrEqual(-tuning.blocks.spreadDeg - 1e-9);
      expect(offs[0]).toBeLessThanOrEqual(1e-9);
      expect(offs[1]).toBeGreaterThanOrEqual(-1e-9);
      expect(offs[1]).toBeLessThanOrEqual(tuning.blocks.spreadDeg + 1e-9);
    }
  });

  test('ボール大量は ±megaSpreadDeg の扇を 6 等分し、それぞれに 1 個ずつ出す', () => {
    const spread = tuning.blocks.megaSpreadDeg;
    const slot = (2 * spread) / tuning.blocks.ballsFromMega;
    for (let seed = 1; seed <= 50; seed++) {
      const { center, spawned } = burst('M', seed, 1);
      expect(spawned.length).toBe(tuning.blocks.ballsFromMega);
      spawned.forEach((d, k) => {
        const off = d - center;
        expect(off).toBeGreaterThanOrEqual(-spread + slot * k - 1e-9);
        expect(off).toBeLessThanOrEqual(-spread + slot * (k + 1) + 1e-9);
        expect(Math.abs(Math.sin(d * DEG))).toBeGreaterThanOrEqual(minDy);
      });
    }
  });
});

describe('パドル', () => {
  test('中央で受けると真上、端で受けると maxBounceDeg まで傾く', () => {
    for (const [offset, expectDeg] of [
      [0, 0],
      [tuning.paddle.width / 2 + R, tuning.paddle.maxBounceDeg],
      [-(tuning.paddle.width / 2 + R), -tuning.paddle.maxBounceDeg],
    ] as const) {
      const sim = makeSim(PLAIN);
      sim.step({ paddleTargetX: 4.5, launch: false });
      placeBall(sim, 4.5 + offset, PADDLE_Y + 0.6, 0, -1);
      let hit = false;
      runSteps(sim, 30, () => {
        if (sim.events.counts[EventKind.PaddleHit] > 0 && !hit) {
          hit = true;
          const deg = (Math.atan2(sim.balls.dx[0], sim.balls.dy[0]) * 180) / Math.PI;
          expect(deg).toBeCloseTo(expectDeg, 6);
        }
      });
      expect(hit).toBe(true);
    }
  });

  test('1 ステップで大きく動かしたパドルでも、通過した範囲のボールを拾う', () => {
    const sim = makeSim(PLAIN);
    sim.step({ paddleTargetX: 1.2, launch: false });
    placeBall(sim, 4.5, PADDLE_Y + tuning.paddle.height / 2 + R + 0.01, 0, -1);
    sim.step({ paddleTargetX: 7.8, launch: false });
    expect(sim.events.counts[EventKind.PaddleHit]).toBe(1);
    expect(sim.balls.dy[0]).toBeGreaterThan(0);
  });

  test('パドルの下を抜けたボールは y < -R で消える', () => {
    const sim = makeSim(PLAIN);
    sim.step({ paddleTargetX: 1.2, launch: false });
    placeBall(sim, 8, 1, 0, -1);
    placeBall(sim, 8.2, 5, 0, 1);
    let lostAt = -1;
    let step = 0;
    runSteps(sim, 40, () => {
      step++;
      if (lostAt < 0 && sim.balls.count === 1) lostAt = step;
    });
    // 速さ 9 で 1.1 進むと消える
    expect(lostAt).toBe(Math.floor((1 + R) / (tuning.ball.speedStart * STEP_DT)) + 1);
    expect(sim.balls.count).toBe(1);
    expect(sim.balls.x[0]).toBeCloseTo(8.2, 9);
  });

  test('奈落に落ちたボールは、ステップの終わりの時刻の位置と速度を Drain で知らせる', () => {
    const sim = makeSim(PLAIN);
    sim.step({ paddleTargetX: 1.2, launch: false });
    const [dx, dy] = [0.6, -0.8];
    placeBall(sim, 7, 1, dx, dy);
    // 速さは時間とともに少しずつ上がるので、進んだ距離はステップごとの速さから足し合わせる
    let d = 0;
    let found = false;
    runSteps(sim, 40, () => {
      d += sim.speed * STEP_DT;
      const ev = sim.events;
      for (let i = 0; i < ev.length; i++) {
        if (ev.kind[i] !== EventKind.Drain) continue;
        found = true;
        expect(ev.t[i]).toBe(sim.time);
        // 止められずにそのまま進んだとしたときの位置
        expect(ev.x[i]).toBeCloseTo(7 + dx * d, 5);
        expect(ev.y[i]).toBeCloseTo(1 + dy * d, 5);
        expect(ev.y[i]).toBeLessThan(-R);
        expect(ev.a[i]).toBeCloseTo(dx * sim.speed, 5);
        expect(ev.b[i]).toBeCloseTo(dy * sim.speed, 5);
      }
    });
    expect(found).toBe(true);
    expect(sim.balls.count).toBe(0);
  });
});

describe('ステージ', () => {
  test('残機 3 はプレイ中のボールを含み、3 回ミスでゲームオーバー', () => {
    const sim = makeSim(PLAIN);
    expect(sim.lives).toBe(3);
    for (let miss = 1; miss <= 3; miss++) {
      clearBalls(sim);
      placeBall(sim, 8.8, 0.5, 0, -1);
      let signals = 0;
      runSteps(sim, 30, () => {
        signals |= sim.events.signals;
      });
      expect(signals & Signal.BallsZero).toBeTruthy();
      expect(sim.lives).toBe(3 - miss);
      if (miss < 3) {
        expect(signals & Signal.LifeLost).toBeTruthy();
        expect(sim.attached).toBe(true);
        expect(sim.phase).toBe('playing');
      } else {
        expect(signals & Signal.GameOver).toBeTruthy();
        expect(sim.phase).toBe('over');
      }
    }
  });

  test('全部壊すとクリアになり、最後に壊したブロックの位置を伝える', () => {
    const sim = makeSim(stageMode(emptyRows(10).concat([line(2, 'o')])), 1, (t) => {
      t.blocks.ballsFromBall = 0;
    });
    const cx = cellCenterX(2);
    const cy = sim.blocks.centerY(0);
    placeBall(sim, cx, cy - 1, 0, 1);
    let signals = 0;
    let sx = 0;
    let sy = 0;
    runSteps(sim, 60, () => {
      if (sim.events.signals & Signal.StageClear) {
        sx = sim.events.signalX;
        sy = sim.events.signalY;
      }
      signals |= sim.events.signals;
    });
    expect(signals & Signal.StageClear).toBeTruthy();
    expect(sim.phase).toBe('cleared');
    expect(sx).toBeCloseTo(cx, 5);
    expect(sy).toBeCloseTo(cy, 5);
  });

  test('壊せるブロックがなくなればクリアになる。壊れないブロックは残っていてよい', () => {
    const sim = makeSim(stageMode(emptyRows(10).concat(['XXXX......XX', line(2, 'o')])), 1, (t) => {
      t.blocks.ballsFromBall = 0;
    });
    expect([sim.blocks.liveCount, sim.blocks.breakableCount]).toEqual([7, 1]);
    placeBall(sim, cellCenterX(2), sim.blocks.centerY(0) - 1, 0, 1);
    let signals = 0;
    runSteps(sim, 60, () => {
      signals |= sim.events.signals;
    });
    expect(signals & Signal.StageClear).toBeTruthy();
    expect(sim.phase).toBe('cleared');
    expect([sim.blocks.liveCount, sim.blocks.breakableCount]).toEqual([6, 0]);
  });

  test('クリアした後は、ボールがクリアしたステップの位置で止まり、何にも当たらない', () => {
    const sim = makeSim(stageMode(emptyRows(10).concat([line(8, 'X'), line(2, 'o')])), 1, (t) => {
      t.blocks.ballsFromBall = 0;
    });
    const solid = sim.blocks.slotOf(1) * COLS + 8;
    placeBall(sim, cellCenterX(2), sim.blocks.centerY(0) - 1, 0, 1);
    // 壊れないブロックへ向かうボールと、奈落へ向かうボール
    placeBall(sim, cellCenterX(8), sim.blocks.centerY(1) - 2, 0, 1);
    placeBall(sim, 5, 2, 0.3, -1);
    for (let s = 0; s < 120 && sim.phase === 'playing'; s++) {
      expect(sim.ballsMoving).toBe(true);
      sim.step(hold(sim));
      sim.events.clear();
    }
    expect(sim.phase).toBe('cleared');
    expect(sim.ballsMoving).toBe(false);
    const b = sim.balls;
    expect(b.count).toBe(3);
    const x = Array.from(b.x.subarray(0, b.count));
    const y = Array.from(b.y.subarray(0, b.count));
    const hitAt = sim.blocks.hitAt[solid];
    runSteps(sim, 600, () => {
      expect(sim.events.length).toBe(0);
      expect(sim.events.signals).toBe(0);
    });
    expect(b.count).toBe(3);
    // 補間の前の位置も今の位置にそろい、描画でも動いて見えない
    for (let i = 0; i < b.count; i++) expect([b.x[i], b.y[i], b.px[i], b.py[i]]).toEqual([x[i], y[i], x[i], y[i]]);
    expect(sim.blocks.hitAt[solid]).toBe(hitAt);
  });

  test('壊れないブロックの破砕は、決着した後に中心が条件に合うものだけを取り除き、得点は変えない', () => {
    const sim = makeSim(stageMode(emptyRows(10).concat(['X....X....XX', line(2, 'o')])), 1, (t) => {
      t.blocks.ballsFromBall = 0;
    });
    const all = () => true;
    const never = () => {
      throw new Error('should not be called');
    };
    expect(sim.shatterSolids(all, never)).toBe(0);
    expect(sim.blocks.liveCount).toBe(5);
    placeBall(sim, cellCenterX(2), sim.blocks.centerY(0) - 1, 0, 1);
    runSteps(sim, 60);
    expect(sim.phase).toBe('cleared');
    const score = sim.score;
    const bonus = sim.clearBonusRemaining;
    const shattered: number[][] = [];
    const n = sim.shatterSolids(
      (x) => x > cellCenterX(4),
      (x, y) => shattered.push([x, y]),
    );
    const cy = sim.blocks.centerY(1);
    expect(n).toBe(3);
    expect(shattered).toEqual([
      [cellCenterX(5), cy],
      [cellCenterX(10), cy],
      [cellCenterX(11), cy],
    ]);
    expect(sim.blocks.type[sim.blocks.slotOf(1) * COLS]).toBe(BlockType.Solid);
    expect([sim.blocks.liveCount, sim.blocks.breakableCount]).toEqual([1, 0]);
    expect(sim.shatterSolids(all, () => undefined)).toBe(1);
    expect(sim.blocks.liveCount).toBe(0);
    expect([sim.score, sim.clearBonusRemaining]).toEqual([score, bonus]);
  });

  test('クリアの位置は、クリアより前のフレームで壊したブロックでは上書きされない', () => {
    const sim = makeSim(stageMode(emptyRows(10).concat([line(2, 'o'), line(9, 'o')])), 1, (t) => {
      t.blocks.ballsFromBall = 0;
    });
    placeBall(sim, cellCenterX(9), sim.blocks.centerY(0) - 1, 0, 1);
    runSteps(sim, 60);
    expect(sim.blocks.liveCount).toBe(1);
    // 壊しただけでは位置を書き込まない
    expect(sim.events.signalX).toBe(0);
    expect(sim.events.signalY).toBe(0);
  });

  test('ゲームオーバーの後は、ボールが動かず、ブロックも壊れない', () => {
    const sim = gameOverWhileAttached();
    expect(sim.ballsMoving).toBe(false);
    const live = sim.blocks.liveCount;
    const score = sim.score;
    placeBall(sim, 4.5, 3, 0.3, 1);
    const b = sim.balls;
    runSteps(sim, 600, () => {
      expect(sim.events.length).toBe(0);
    });
    expect([b.count, b.x[0], b.y[0]]).toEqual([1, 4.5, 3]);
    expect(sim.blocks.liveCount).toBe(live);
    expect(sim.score).toBe(score);
  });

  test('不正なステージは sim を作る時点で分かりやすいエラーになる', () => {
    expect(() => makeSim(stageMode(['ooooo']))).toThrow(/row 1 has 5 columns/);
    expect(() => makeSim(stageMode([line(3, 'x')]))).toThrow(/unknown symbol "x"/);
  });
});

describe('ステージクリアのボールボーナス', () => {
  /** 2 個目のブロックを壊してクリアする。クリアの時点で何個のボールが残っていたかを返す */
  function clearWithBalls(extraBalls: number): Sim {
    const sim = makeSim(stageMode(emptyRows(10).concat([line(2, 'o')])), 1, (t) => {
      t.blocks.ballsFromBall = 0;
    });
    placeBall(sim, cellCenterX(2), sim.blocks.centerY(0) - 1, 0, 1);
    for (let k = 0; k < extraBalls; k++) placeBall(sim, 0.3 + k * 0.1, 3 + k * 0.2, 0.3, 1);
    for (let s = 0; s < 120 && sim.phase === 'playing'; s++) {
      sim.step(hold(sim));
      sim.events.clear();
    }
    expect(sim.phase).toBe('cleared');
    return sim;
  }

  test('クリアの時点で残っていたボールの数がボーナスの対象になり、その後ボールは減らない', () => {
    const sim = clearWithBalls(5);
    expect(sim.clearBonusRemaining).toBe(6);
    // パドルを端に寄せて、ボールを拾わない
    for (let s = 0; s < 3000; s++) {
      sim.step({ paddleTargetX: 0, launch: false });
      sim.events.clear();
      expect(sim.balls.count).toBe(6);
    }
    expect(sim.clearBonusRemaining).toBe(6);
  });

  test('少しずつ加えても、まとめて加えても、最終的なスコアは同じ', () => {
    const watched = clearWithBalls(7);
    const skipped = clearWithBalls(7);
    const base = watched.score;
    expect(skipped.score).toBe(base);
    const points = tuning.score.pointsClearBall;

    let credited = 0;
    for (const n of [1, 3, 2]) credited += watched.creditClearBonus(n);
    expect(credited).toBe(6);
    expect(watched.clearBonusRemaining).toBe(2);
    // 残りより多く頼んでも、残りの分だけ
    expect(watched.creditClearBonus(10)).toBe(2);
    expect(watched.creditClearBonus(1)).toBe(0);

    expect(skipped.creditClearBonus(Infinity)).toBe(8);
    expect(watched.score).toBe(base + 8 * points);
    expect(skipped.score).toBe(watched.score);
  });

  test('ボーナスには chain 倍率がかからない', () => {
    const sim = clearWithBalls(3);
    expect(sim.chainMultiplier).toBeGreaterThan(1);
    const before = sim.score;
    sim.creditClearBonus(2);
    expect(sim.score).toBe(before + 2 * tuning.score.pointsClearBall);
  });

  test('有限でない数や負の数は何も加えない', () => {
    const sim = clearWithBalls(2);
    const before = sim.score;
    expect(sim.creditClearBonus(Number.NaN)).toBe(0);
    expect(sim.creditClearBonus(-3)).toBe(0);
    expect(sim.score).toBe(before);
  });

  test('最後のブロックを壊したステップでボールを失っても、クリアになる', () => {
    const sim = makeSim(stageMode(emptyRows(10).concat([line(2, 'o')])), 1, (t) => {
      t.blocks.ballsFromBall = 0;
    });
    const cy = sim.blocks.centerY(0);
    // ブロックの下面の少し下から上へ向かうボールと、次のステップで奈落へ落ちるボール
    const gap = cy - CELL_H / 2 + BLOCK_INSET_Y - R;
    placeBall(sim, cellCenterX(2), gap - 0.05, 0, 1);
    placeBall(sim, 8.8, -R + 0.05, 0, -1);
    sim.step(hold(sim));
    expect(sim.events.signals & Signal.StageClear).toBeTruthy();
    expect(sim.events.signals & Signal.BallsZero).toBeFalsy();
    expect(sim.phase).toBe('cleared');
    expect(sim.lives).toBe(tuning.stage.lives);
    expect(sim.clearBonusRemaining).toBe(1);
  });
});

describe('ボールの回収', () => {
  test('決着した後に、条件に合うボールだけを取り除き、残りの順序を保つ', () => {
    const sim = gameOverWhileAttached();
    for (let i = 0; i < 10; i++) placeBall(sim, 0.5 + i * 0.8, 3, 0, 1);
    const removed: number[] = [];
    const n = sim.collectBalls(
      (x) => x > 4,
      (x) => removed.push(x),
    );
    expect(n).toBe(removed.length);
    expect(n).toBeGreaterThan(0);
    expect(sim.balls.count).toBe(10 - n);
    for (let i = 1; i < sim.balls.count; i++) expect(sim.balls.x[i]).toBeGreaterThan(sim.balls.x[i - 1]);
    for (let i = 0; i < sim.balls.count; i++) expect(sim.balls.x[i]).toBeLessThanOrEqual(4);
  });

  test('プレイ中は取り除かない', () => {
    const sim = makeSim(PLAIN);
    for (let i = 0; i < 3; i++) placeBall(sim, 1 + i, 3, 0, 1);
    expect(
      sim.collectBalls(
        () => true,
        () => undefined,
      ),
    ).toBe(0);
    expect(sim.balls.count).toBe(3);
  });
});

describe('エンドレス', () => {
  test('発射前はブロックが降りず、発射後は降りる。天井の外に予備の行が 1 行あり続ける', () => {
    const sim = makeSim(ENDLESS, 5);
    const y0 = sim.blocks.lowestRowY;
    runSteps(sim, 240);
    expect(sim.blocks.lowestRowY).toBe(y0);
    sim.step(hold(sim, true));
    runSteps(sim, 1200, () => {
      const topBottom = sim.blocks.topRowBottomY();
      expect(topBottom).toBeGreaterThanOrEqual(FIELD_H - 1e-9);
      expect(topBottom).toBeLessThan(FIELD_H + CELL_H + 1e-9);
    });
  });

  test('ブロックは連続的には動かず、1 段ずつ落ちて着地を知らせる', () => {
    const sim = makeSim(ENDLESS, 5, (t) => {
      t.endless.descentStart = 2;
      t.blocks.ballsFromBall = 0;
    });
    const y0 = sim.blocks.lowestRowY;
    const serial0 = () => (y0 - sim.blocks.lowestRowY) / CELL_H;
    placeBall(sim, 0.3, 3, 0.26, 0.97);
    let landings = 0;
    let dropping = false;
    runSteps(sim, 240, () => {
      if (sim.events.signals & Signal.StepLanded) {
        landings++;
        dropping = false;
      }
      // 着地している間は、必ず段の境目（CELL_H の整数倍）にいる
      const moved = serial0();
      const onGrid = Math.abs(moved - Math.round(moved)) < 1e-6;
      if (!onGrid) dropping = true;
      if (!dropping) expect(onGrid).toBe(true);
    });
    // 2 行/秒で 2 秒なので、4 段前後落ちる
    expect(landings).toBeGreaterThanOrEqual(3);
    expect(landings).toBeLessThanOrEqual(4);
  });

  test('降下速度に上限はない。1 段の落下時間より速い速度でも、その速さで降り続ける', () => {
    for (const rate of [4, 12, 20]) {
      const sim = makeSim(ENDLESS, 1, (t) => {
        t.endless.descentStart = rate;
        t.endless.descentAccelPerMinute = 0;
        t.endless.initialRows = 1;
        // パドルを細くして、ボールを脇の隙間で上下させ続ける
        t.paddle.width = 0.2;
      });
      placeBall(sim, 0.3, 3, 0, 1);
      // 最初の段が着地するまでを除いた 1 秒間に着地した段を数える
      const warmup = Math.ceil(tuning.endless.stepDropSeconds / STEP_DT);
      let landings = 0;
      for (let k = 0; k < warmup + 120; k++) {
        sim.step({ paddleTargetX: 0.3, launch: false });
        if (k >= warmup && sim.events.signals & Signal.StepLanded) landings++;
        sim.events.clear();
      }
      expect(sim.phase).toBe('playing');
      expect(sim.balls.count).toBe(1);
      expect(Math.abs(landings - rate)).toBeLessThanOrEqual(1);
    }
  });

  test('ペナルティで降りてくるブロックは、下にいるボールを押し下げて飲み込まない', () => {
    const sim = makeSim(ENDLESS, 5, (t) => {
      t.blocks.ballsFromBall = 0;
      t.blocks.ballsFromHard = 0;
      t.blocks.ballsFromMega = 0;
      t.endless.penaltyDropSeconds = 0.05;
    });
    const below = sim.blocks.lowestRowY - 0.3;
    // すぐに落ちるボールを 1 個と、ブロックの真下で上向きに動くボールを並べる
    placeBall(sim, 8.8, 0.2, 0, -1);
    for (let k = 0; k < 9; k++) placeBall(sim, 0.45 + k * 0.9, below, 0.26, 0.97);
    runSteps(sim, 40, () => assertNoBallInsideBlocks(sim));
  });

  test('降りてくるブロックに押されても、1 ステップで同じブロックに 2 回以上当たったことにはしない', () => {
    const sim = makeSim(ENDLESS, 3, (t) => {
      t.blocks.ballsFromBall = 0;
      t.blocks.ballsFromHard = 0;
      t.blocks.ballsFromMega = 0;
      t.endless.hardRatioStart = 1;
      t.endless.megaRatio = 0;
    });
    const f = sim.blocks;
    clearVisibleRows(sim);
    placeBall(sim, cellCenterX(5), 15.5, 0.2588, 0.9659);
    let damage = 0;
    const hp = new Uint8Array(f.hp.length);
    const type = new Uint8Array(f.type.length);
    for (let s = 0; s < 80; s++) {
      hp.set(f.hp);
      type.set(f.type);
      sim.step(hold(sim));
      sim.events.clear();
      for (let i = 0; i < hp.length; i++) {
        if (type[i] !== BlockType.Hard || f.type[i] !== BlockType.Hard) continue;
        const d = hp[i] - f.hp[i];
        // 行を補充するとセルの中身が入れ替わるので、減った分だけを見る
        if (d > 0) {
          expect(d).toBe(1);
          damage += d;
        }
      }
    }
    expect(damage).toBeGreaterThan(0);
  });

  test('ボールが 0 個になると 3 段降りて、着地を知らせ、ボールがパドルに乗る', () => {
    const sim = makeSim(ENDLESS, 5);
    placeBall(sim, 8.8, 0.3, 0, -1);
    let y0 = 0;
    let signals = 0;
    runSteps(sim, 10, () => {
      // ボールが飛んでいる間は通常の降下があるので、0 個になった時点の位置を基準にする
      if (sim.events.signals & Signal.BallsZero) y0 = sim.blocks.lowestRowY;
      signals |= sim.events.signals;
    });
    expect(signals & Signal.BallsZero).toBeTruthy();
    expect(sim.attached).toBe(true);
    runSteps(sim, Math.ceil(tuning.endless.penaltyDropSeconds / STEP_DT) + 2, () => {
      signals |= sim.events.signals;
    });
    expect(signals & Signal.PenaltyLanded).toBeTruthy();
    // 発射待ちの間は通常の降下は止まるので、降りた量はペナルティ分だけ
    expect(y0 - sim.blocks.lowestRowY).toBeCloseTo(tuning.endless.penaltyRows * CELL_H, 9);
  });

  test('1 段の降下の途中でボールが 0 個になると、残りをペナルティにまとめて落とす', () => {
    const sim = makeSim(ENDLESS, 5, (t) => {
      t.endless.descentStart = 60;
      t.endless.descentAccelPerMinute = 0;
      t.endless.gapRowsMin = 0;
      t.endless.gapRowsMax = 0;
    });
    const y0 = sim.blocks.lowestRowY;
    // 3 ステップ目に奈落へ落ちるボール。2 ステップ目に 1 段の降下が始まる
    placeBall(sim, 8.8, R, 0, -1);
    let signals = 0;
    for (let s = 0; s < 3; s++) {
      sim.step(hold(sim));
      signals |= sim.events.signals;
      sim.events.clear();
    }
    expect(signals & Signal.BallsZero).toBeTruthy();
    runSteps(sim, 60, () => {
      signals |= sim.events.signals;
    });
    expect(signals & Signal.PenaltyLanded).toBeTruthy();
    expect(signals & Signal.StepLanded).toBeFalsy();
    expect(y0 - sim.blocks.lowestRowY).toBeCloseTo((tuning.endless.penaltyRows + 1) * CELL_H, 9);
  });

  test('ブロックが危険ラインに届くとゲームオーバー', () => {
    // 一番下の行を危険ラインのすぐ上から始め、ボールが一番下の行を壊して押し返す前に届くよう、降下を速くする
    const sim = makeSim(ENDLESS, 5, (t) => {
      t.endless.initialRows = rowsReaching(DANGER_Y) - 1;
      t.endless.descentStart = 3;
    });
    expect(sim.blocks.lowestLiveBlockBottom()).toBeGreaterThan(DANGER_Y);
    sim.step(hold(sim, true));
    let signals = 0;
    runSteps(sim, 600, () => {
      signals |= sim.events.signals;
    });
    expect(signals & Signal.GameOver).toBeTruthy();
    expect(sim.phase).toBe('over');
    expect(sim.blocks.lowestLiveBlockBottom()).toBeLessThanOrEqual(DANGER_Y + 1e-9);
  });

  test('全部消すと、補充する行を天井の外から落とし入れる', () => {
    const sim = makeSim(ENDLESS, 5);
    const f = sim.blocks;
    // 天井の外の予備の行は残して、見えている行だけを消す
    clearVisibleRows(sim);
    expect(f.liveCount).toBe(COLS);
    placeBall(sim, 4.5, 3, 0.2, 1);
    sim.step(hold(sim));
    expect(sim.events.signals & Signal.AllClear).toBeTruthy();
    const refilled = f.liveCount;
    expect(refilled).toBeGreaterThan(tuning.endless.refillRows * COLS * 0.6);
    expect(refilled).toBeLessThanOrEqual(tuning.endless.refillRows * COLS);
    expect(f.lowestRowY).toBeCloseTo(FIELD_H, 9);
    sim.events.clear();
    let signals = 0;
    let landedAt = -1;
    runSteps(sim, Math.ceil(tuning.endless.refillDropSeconds / STEP_DT) + 2, () => {
      signals |= sim.events.signals;
      if (landedAt < 0 && sim.events.signals & Signal.RefillLanded) landedAt = f.lowestRowY;
    });
    // 着地したステップで知らせる。落ちている途中の補充は、全消しとして数え直さない
    expect(landedAt).toBeCloseTo(FIELD_H - tuning.endless.refillRows * CELL_H, 9);
    expect(signals & Signal.AllClear).toBeFalsy();
    expect(signals & Signal.PenaltyLanded).toBeFalsy();
    expect(f.lowestRowY).toBeCloseTo(FIELD_H - tuning.endless.refillRows * CELL_H, 9);
    expect(f.liveCountBelow(FIELD_H - BLOCK_INSET_Y)).toBe(refilled);
    expect(f.topRowBottomY()).toBeGreaterThanOrEqual(FIELD_H - 1e-9);
  });

  test('見えている最後のブロックを壊すと、その中心を位置として全消しを知らせる', () => {
    const sim = makeSim(ENDLESS, 5);
    clearVisibleRows(sim);
    setBlock(sim, 0, 4, BlockType.Ball, 1);
    const cy = sim.blocks.centerY(0);
    placeBall(sim, cellCenterX(4), cy - 1.5, 0, 1);
    const at: number[] = [];
    let breaks = 0;
    runSteps(sim, 120, () => {
      const ev = sim.events;
      breaks += ev.counts[EventKind.BlockBreak];
      if (at.length === 0 && ev.signals & Signal.AllClear) at.push(ev.signalX, ev.signalY);
    });
    expect(breaks).toBeGreaterThanOrEqual(1);
    expect(at).toEqual([cellCenterX(4), cy]);
  });

  test('全部消したのと同じステップでボールが 0 個になると、補充とペナルティを合わせて落とす', () => {
    const sim = makeSim(ENDLESS, 5, (t) => {
      t.endless.gapRowsMin = 0;
      t.endless.gapRowsMax = 0;
    });
    clearVisibleRows(sim);
    placeBall(sim, 8.8, -R + 0.01, 0, -1);
    sim.step(hold(sim));
    expect(sim.events.signals & Signal.BallsZero).toBeTruthy();
    expect(sim.blocks.lowestRowY).toBeCloseTo(FIELD_H, 9);
    let signals = 0;
    runSteps(sim, Math.ceil(tuning.endless.penaltyDropSeconds / STEP_DT) + 2, () => {
      signals |= sim.events.signals;
    });
    expect(signals & Signal.PenaltyLanded).toBeTruthy();
    expect(signals & Signal.RefillLanded).toBeTruthy();
    const rows = tuning.endless.refillRows + tuning.endless.penaltyRows;
    expect(sim.blocks.lowestRowY).toBeCloseTo(FIELD_H - rows * CELL_H, 9);
  });

  test('行の中身は出現率に従い、帯と帯の間に横一直線の空の行が入る', () => {
    const sim = makeSim(ENDLESS, 11, (t) => {
      t.endless.initialRows = 40;
    });
    const f = sim.blocks;
    let hard = 0;
    let mega = 0;
    let total = 0;
    let rows = 0;
    let gapRows = 0;
    let run = 0;
    for (let row = 0; row < f.rowCount; row++) {
      if (f.rowBottomY(row) >= FIELD_H - 1e-6) continue;
      rows++;
      const live = f.rowLive[f.slotOf(row)];
      // 行は、全部埋まっているか、全部空いているかのどちらか
      expect(live === 0 || live === COLS).toBe(true);
      if (live === 0) {
        gapRows++;
        run++;
        expect(run).toBeLessThanOrEqual(tuning.endless.gapRowsMax);
        continue;
      }
      run = 0;
      for (let col = 0; col < COLS; col++) {
        const idx = f.slotOf(row) * COLS + col;
        const t = f.type[idx];
        total++;
        if (t === BlockType.Hard) {
          hard++;
          expect(f.hp[idx]).toBe(tuning.endless.hardHpStart);
        }
        if (t === BlockType.Mega) mega++;
      }
    }
    expect(gapRows / rows).toBeGreaterThan(0.08);
    expect(gapRows / rows).toBeLessThan(0.35);
    expect(hard / total).toBeGreaterThan(0.08);
    expect(hard / total).toBeLessThan(0.22);
    expect(mega).toBeLessThan(16);
  });

  test('調整値の上限でも、行のリングバッファはあふれない', () => {
    const extreme = (t: Tuning) => {
      t.endless.initialRows = 20;
      t.endless.refillRows = 1000;
      t.endless.penaltyRows = 1000;
      t.endless.descentStart = 1e9;
      t.endless.stepDropSeconds = 0;
      t.endless.penaltyDropSeconds = 0;
      t.endless.refillDropSeconds = 0;
    };
    // 速い降下の途中で、ボールが 0 個になって最大のペナルティが一度に来る
    const a = makeSim(ENDLESS, 2, extreme);
    placeBall(a, 8.8, R, 0, -1);
    expect(() => runSteps(a, 120)).not.toThrow();
    expect(a.phase).toBe('over');
    // 全消しの補充と、最大のペナルティが同じステップで来る
    const b = makeSim(ENDLESS, 2, extreme);
    clearVisibleRows(b);
    placeBall(b, 8.8, -R + 0.01, 0, -1);
    expect(() => runSteps(b, 120)).not.toThrow();
    expect(b.phase).toBe('over');
  });
});

describe('タイトル画面の sim', () => {
  test('ブロックもボールもなく、step() しても何も変わらない', () => {
    const sim = Sim.idle();
    expect(sim.blocks.liveCount).toBe(0);
    expect(sim.blocks.rowCount).toBe(0);
    expect(sim.balls.count).toBe(0);
    const v = sim.blocks.version;
    for (let i = 0; i < 100; i++) sim.step({ paddleTargetX: 1 + i * 0.05, launch: i % 10 === 0 });
    sim.debugSpawnBalls(50);
    expect(sim.time).toBe(0);
    expect(sim.balls.count).toBe(0);
    expect(sim.blocks.version).toBe(v);
    expect(sim.paddleX).toBe(FIELD_W / 2);
    expect(sim.events.length).toBe(0);
    expect(sim.phase).toBe('playing');
  });
});

describe('開発用のボールの追加', () => {
  test('パドルに乗っているボールはそのままで、ブロックに重ならない位置に置く', () => {
    // ボールを置く帯（パドルの少し上）までブロックが並ぶように、初期の行を増やす
    const sim = makeSim(ENDLESS, 4, (t) => {
      t.endless.initialRows = rowsReaching(PADDLE_Y + 1);
    });
    const f = sim.blocks;
    expect(f.lowestRowY).toBeLessThanOrEqual(PADDLE_Y + 1);
    expect(f.lowestRowY).toBeGreaterThan(PADDLE_Y + 0.5);
    sim.debugSpawnBalls(200);
    expect(sim.attached).toBe(true);
    expect(sim.balls.count).toBeGreaterThan(0);
    expect(sim.balls.count).toBeLessThanOrEqual(200);
    assertBallInvariants(sim);
    for (let i = 0; i < sim.balls.count; i++) {
      const row = f.rowAtY(sim.balls.y[i]);
      const col = colAtX(sim.balls.x[i]);
      if (row < 0 || col < 0 || col >= COLS) continue;
      const idx = f.slotOf(row) * COLS + col;
      if (f.type[idx] === BlockType.Empty) continue;
      const bx0 = cellLeft(col) + BLOCK_INSET_X;
      const by0 = f.rowBottomY(row) + BLOCK_INSET_Y;
      const cx = Math.max(bx0, Math.min(bx0 + BLOCK_W, sim.balls.x[i]));
      const cy = Math.max(by0, Math.min(by0 + BLOCK_H, sim.balls.y[i]));
      expect(Math.hypot(sim.balls.x[i] - cx, sim.balls.y[i] - cy)).toBeGreaterThanOrEqual(R);
    }
  });

  test('上限を超えては足さず、同じシードなら同じ位置に置く', () => {
    const a = makeSim(ENDLESS, 9);
    const b = makeSim(ENDLESS, 9);
    a.debugSpawnBalls(BALL_CAP * 2);
    b.debugSpawnBalls(BALL_CAP * 2);
    expect(a.balls.count).toBe(BALL_CAP);
    for (let i = 0; i < BALL_CAP; i++) {
      expect(a.balls.x[i]).toBe(b.balls.x[i]);
      expect(a.balls.dy[i]).toBe(b.balls.dy[i]);
    }
  });
});

describe('決定性', () => {
  test('長時間の自動プレイでも不変条件が崩れない', () => {
    const sim = makeSim(ENDLESS, 99);
    let maxBalls = 0;
    let broken = 0;
    for (let i = 0; i < 20000 && sim.phase === 'playing'; i++) {
      sim.step(autoplayInput(sim, i));
      broken += sim.events.counts[EventKind.BlockBreak];
      sim.events.clear();
      maxBalls = Math.max(maxBalls, sim.balls.count);
      if (i % 50 === 0) {
        assertBallInvariants(sim);
        assertNoBallInsideBlocks(sim);
        expect(sim.balls.count).toBeLessThanOrEqual(BALL_CAP);
        let live = 0;
        for (let row = 0; row < sim.blocks.rowCount; row++) live += sim.blocks.rowLive[sim.blocks.slotOf(row)];
        expect(live).toBe(sim.blocks.liveCount);
      }
    }
    expect(broken).toBeGreaterThan(100);
    expect(maxBalls).toBeGreaterThan(20);
  });
});

describe('BlockField の version', () => {
  test('格子の位置やセルの中身が変わるたびに増える', () => {
    const f = new BlockField();
    let v = f.version;
    const bumped = () => {
      expect(f.version).toBeGreaterThan(v);
      v = f.version;
    };
    f.placeAt(10);
    bumped();
    const row = f.pushRowTop();
    bumped();
    f.setCell(row, 3, BlockType.Hard, 3, 0);
    bumped();
    const idx = f.slotOf(row) * COLS + 3;
    f.markHit(idx, 1);
    bumped();
    expect(f.damageAt(idx)).toBe(2);
    bumped();
    f.shiftDown(0.1);
    bumped();
    f.removeAt(idx);
    bumped();
    f.removeAt(idx);
    expect(f.version).toBe(v);
    f.pruneEmptyBottomRows();
    bumped();
  });
});
