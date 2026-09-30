import { describe, expect, test } from 'bun:test';
import { CEREMONY, CEREMONY_MOTION, flipTier, hitStopFor, SLOW_MO, WARP_ARRIVE } from '../config.ts';
import { cellX, cellY } from '../geometry.ts';
import { runResult, sheetOf } from '../result.test-support.ts';
import { BLACK, countOf, parseSquare, positionFromRows, WHITE } from '../rules/position.ts';
import type { RunResult } from '../types.ts';
import { LOOK } from '../view/look.ts';
import { DISC_OFFSET, DISC_STRIDE, LONG_AGO } from './discs.ts';
import { DirectorKit } from './test-kit.test-support.ts';

/** 黒が a2 に打つと 14 枚返る局面 */
const BIG = positionFromRows(['..XXXXXX', '.OOOOOOX', 'OOOOOOOO', 'OXOOXXOO', 'OXOOOOXO', 'OOXXXOXO', 'OXXXXXOO', 'X.XXXOOO'], BLACK);
/** 黒が c4 に打つと 7 枚返る局面 */
const SEVEN = positionFromRows(['........', '........', '........', '...OOOX.', '..OO....', '..O.O...', '..X..X..', '........'], BLACK);

/** 黒が a1（角）に打つと 6 枚返る局面（段階 3） */
const CORNER_BIG = positionFromRows(['.OOOOOOX', '........', '........', '........', '........', '........', '........', '........'], BLACK);

/** 記録した呼び出しの名前（BGM のつまみは毎フレーム送るので除く） */
const names = (kit: DirectorKit): string[] => kit.rec.log.filter((l) => !l.name.startsWith('bgm.')).map((l) => l.name);

/** 始まりの演出を終えたキット */
function started(opts: ConstructorParameters<typeof DirectorKit>[0] = {}): DirectorKit {
  const kit = new DirectorKit(opts);
  const end = kit.intro();
  kit.until(end);
  kit.rec.log.length = 0;
  return kit;
}

describe('Director の始まりの演出', () => {
  test('盤が現れ、初期配置の 4 石が 1 つずつ落ちて盤に見えるようになる', () => {
    const kit = new DirectorKit();
    const end = kit.intro();
    kit.frame();
    expect(kit.discs.countShown(BLACK) + kit.discs.countShown(WHITE)).toBe(0);
    expect(kit.fx.boardAppear).toBeLessThan(1);
    kit.until(end);
    expect(kit.rec.count('sfx.introDrop')).toBe(4);
    expect([kit.discs.countShown(BLACK), kit.discs.countShown(WHITE)]).toEqual([2, 2]);
    expect(kit.fx.boardAppear).toBe(1);
  });
});

describe('Director の着手の演出', () => {
  test('石が着く音・返る音は、時間割の時刻が来たフレームで鳴る', () => {
    const kit = started({ start: SEVEN });
    const { choreo, start } = kit.play(parseSquare('c4'));
    kit.frame();
    // 打った直後はまだ何も鳴らない（石は落ちている途中）
    expect(kit.rec.count('sfx.place')).toBe(0);
    expect(kit.rec.count('sfx.flipStep')).toBe(0);
    kit.until(start + choreo.end + 0.1);
    const place = kit.rec.calls('sfx.place');
    expect(place).toHaveLength(1);
    expect(place[0].world).toBeGreaterThanOrEqual(start + choreo.landAt);
    expect(place[0].world).toBeLessThan(start + choreo.landAt + 1 / 60 + 1e-9);
    const steps = kit.rec.calls('sfx.flipStep');
    expect(steps).toHaveLength(choreo.steps.length);
    choreo.steps.forEach((s, i) => {
      expect(steps[i].world).toBeGreaterThanOrEqual(start + s.time);
      expect(steps[i].world).toBeLessThan(start + s.time + 1 / 60 + 1e-9);
      expect(steps[i].args).toEqual(['human', s.index, s.count, choreo.tier]);
    });
  });

  test('盤に見える石の数は、1 枚ずつ返りきったときに変わる', () => {
    const kit = started({ start: SEVEN });
    const before = kit.discs.countShown(BLACK);
    const { choreo, start } = kit.play(parseSquare('c4'));
    kit.until(start + choreo.landAt + 0.01);
    expect(kit.discs.countShown(BLACK)).toBe(before + 1);
    kit.until(start + choreo.steps[0].time + 0.01);
    expect(kit.discs.countShown(BLACK)).toBe(before + 1 + choreo.steps[0].count);
    kit.until(start + choreo.end);
    expect(kit.discs.countShown(BLACK)).toBe(countOf(kit.match.position, BLACK));
    expect(kit.discs.countShown(WHITE)).toBe(countOf(kit.match.position, WHITE));
  });

  test('人の手は、石が返りきるたびに枚数を数え上げて盤の上に出す。段階 2 以上は返り始めに低音とシンバルを鳴らす', () => {
    const kit = started({ start: SEVEN });
    const { choreo, start } = kit.play(parseSquare('c4'));
    kit.until(start + choreo.steps[0].time - 0.02);
    expect(kit.callouts).toHaveLength(0);
    kit.until(start + choreo.end);
    const counts = kit.callouts.flatMap((c) => (c.kind === 'flips' ? [[c.count, c.level, c.final]] : []));
    let sum = 0;
    expect(counts).toEqual(
      choreo.steps.map((s, i) => {
        sum += s.count;
        return [sum, flipTier(sum), i === choreo.steps.length - 1];
      }),
    );
    expect(kit.rec.calls('sfx.burst').map((c) => c.args)).toEqual([[flipTier(7)]]);
  });

  test('いちばん大きな手は、着いた音の後、ヒットストップと溜めの間を無音にし、スローモーションで返す', () => {
    const kit = started({ start: BIG });
    const { choreo, start } = kit.play(parseSquare('a2'));
    expect(choreo.tier).toBe(4);
    kit.until(start + choreo.end);
    const silence = kit.rec.calls('audio.silence');
    expect(silence).toHaveLength(1);
    // 着いたフレームで、着いた音の立ち上がりを残して（delay）から、ヒットストップと溜めの長さだけ無音にする
    expect(silence[0].world).toBe(kit.rec.calls('sfx.place')[0].world);
    const [duration, , delay] = silence[0].args as number[];
    expect(delay).toBeGreaterThan(0);
    expect(delay + duration).toBeCloseTo(hitStopFor(14, false) + (choreo.waveAt - choreo.landAt), 9);
    expect(kit.rec.calls('sfx.inhale')[0].args[0]).toBeCloseTo(delay + duration, 9);
    // スローモーションの間は、世界時間が実時間より遅く進む
    expect(kit.ft.real).toBeGreaterThan(kit.ft.world);
    expect(kit.rec.count('vibrate')).toBeGreaterThan(0);
  });

  test('CPU の手は文字を出さず、下がっていく音で返し、多く返したら不穏な和音を鳴らす', () => {
    const kit = started({ setup: { human: WHITE }, start: SEVEN });
    const { choreo, start } = kit.play(parseSquare('c4'));
    kit.until(start + choreo.end);
    expect(kit.callouts).toHaveLength(0);
    expect(kit.rec.calls('sfx.place')[0].args[0]).toBe('cpu');
    expect(kit.rec.calls('sfx.flipStep').every((c) => c.args[0] === 'cpu')).toBe(true);
    expect(kit.rec.count('sfx.dread')).toBe(1);
    expect(kit.rec.count('sfx.burst')).toBe(0);
  });

  test('3 枚以上返す人の手は、石が着いた瞬間から世界を止める（ヒットストップ）。止める長さは枚数で決まる', () => {
    const kit = started({ start: SEVEN });
    const { choreo, start } = kit.play(parseSquare('c4'));
    kit.until(start + choreo.landAt);
    const placed = kit.rec.calls('sfx.place')[0];
    expect(placed.args).toEqual(['human', flipTier(7)]);
    const world = kit.ft.world;
    const real = kit.ft.real;
    kit.frame();
    expect(kit.ft.world).toBe(world);
    while (kit.ft.world === world) kit.frame();
    expect(kit.ft.real - real).toBeCloseTo(hitStopFor(7, false), 1);
    expect(kit.rec.count('vibrate')).toBeGreaterThan(0);
  });

  test('1〜2 枚の人の手と CPU の手は止めない', () => {
    const small = started();
    const a = small.play(parseSquare('f5'));
    small.until(a.start + a.choreo.landAt);
    const w = small.ft.world;
    small.frame();
    expect(small.ft.world).toBeGreaterThan(w);

    const cpu = started({ setup: { human: WHITE }, start: SEVEN });
    const b = cpu.play(parseSquare('c4'));
    cpu.until(b.start + b.choreo.landAt);
    const w2 = cpu.ft.world;
    cpu.frame();
    expect(cpu.ft.world).toBeGreaterThan(w2);
    expect(cpu.rec.count('sfx.swoosh')).toBe(0);
  });

  test('人の手は落ちてくる間に風を切る音を鳴らし、着いた瞬間にコンボの音を鳴らす。数え直した 1 手目も鳴らす', () => {
    const kit = started();
    const { choreo, start } = kit.play(parseSquare('f5'), { combo: 3 });
    expect(kit.rec.calls('sfx.swoosh').map((c) => c.world)).toEqual([start]);
    kit.until(start + choreo.landAt + 0.01);
    expect(kit.rec.calls('sfx.combo').map((c) => c.args)).toEqual([[3]]);

    const first = started();
    const r = first.play(parseSquare('f5'), { combo: 1 });
    first.until(r.start + r.choreo.landAt + 0.01);
    expect(first.rec.calls('sfx.combo').map((c) => c.args)).toEqual([[1]]);
  });

  test('コンボが 2 以上なら、石が着いた瞬間に、置いた石の位置へコンボの数を出す。1 のときは出さない', () => {
    const kit = started();
    const { choreo, start } = kit.play(parseSquare('f5'), { combo: 2 });
    kit.until(start + choreo.landAt - 0.02);
    expect(kit.callouts.filter((c) => c.kind === 'combo')).toEqual([]);
    kit.until(start + choreo.landAt + 0.01);
    const f5 = parseSquare('f5');
    expect(kit.callouts.filter((c) => c.kind === 'combo')).toEqual([{ kind: 'combo', count: 2, x: cellX(f5), y: cellY(f5) }]);

    const one = started();
    const r = one.play(parseSquare('f5'), { combo: 1 });
    one.until(r.end);
    expect(one.callouts.some((c) => c.kind === 'combo')).toBe(false);
  });

  test('返りきった後に得点の音と文字を出し、HUD の得点はそのときに増える', () => {
    const kit = started({ start: SEVEN });
    const { choreo, start, human } = kit.play(parseSquare('c4'), { combo: 6 });
    if (!human) throw new Error('the move was not the human side');
    kit.until(start + choreo.lastLandAt);
    kit.director.hud(kit.hud);
    expect(kit.hud.score).toBe(0);
    kit.until(start + choreo.end + 0.2);
    kit.director.hud(kit.hud);
    expect(kit.hud.score).toBe(human.score.total);
    expect(kit.rec.calls('sfx.score').map((c) => c.args)).toEqual([[1.5, false]]);
    const score = kit.callouts.find((c) => c.kind === 'score');
    expect(score).toMatchObject({ kind: 'score', points: human.score.total, multiplier: 1.5, quick: false });
  });

  test('早打ちの手は、早打ちの点を含めた得点の文字に早打ちの印を付け、得点の音にも知らせる', () => {
    const kit = started({ start: SEVEN });
    const { choreo, start, human } = kit.play(parseSquare('c4'), { combo: 6, quick: true });
    if (!human) throw new Error('the move was not the human side');
    kit.until(start + choreo.end + 0.2);
    expect(human.score.quick).toBeGreaterThan(0);
    expect(kit.rec.calls('sfx.score').map((c) => c.args)).toEqual([[1.5, true]]);
    expect(kit.callouts.find((c) => c.kind === 'score')).toMatchObject({ points: human.score.total, quick: true });
  });

  test('コンボの数によらず、コンボは置いた石の位置にだけ出し、盤の真ん中の文字や光を足さない', () => {
    const kinds = (combo: number) => {
      const kit = started();
      const r = kit.play(parseSquare('f5'), { combo });
      kit.until(r.start + 3);
      return { callouts: kit.callouts.map((c): string => c.kind), flashes: kit.rec.count('flash.request') };
    };
    const four = kinds(4);
    const five = kinds(5);
    expect(five.callouts).toEqual(['combo', 'score']);
    expect(five).toEqual(four);
  });

  test('対局中の得点が最高スコアを超えた手で、1 回だけ更新の演出を出す。記録がなければ出さない', () => {
    const kit = started({ bestScore: 15 });
    const first = kit.play(parseSquare('f5'));
    kit.until(first.end);
    expect(kit.rec.count('sfx.newBest')).toBe(0);
    kit.play(parseSquare('d6'));
    kit.until(20);
    const second = kit.play(parseSquare(kit.match.position.turn === BLACK ? 'c3' : 'e3'));
    kit.until(second.start + 3);
    kit.director.hud(kit.hud);
    expect(kit.hud.newBest).toBe(true);
    expect(kit.rec.count('sfx.newBest')).toBe(1);

    const none = started({ bestScore: 0 });
    const r = none.play(parseSquare('f5'));
    none.until(r.start + 3);
    none.director.hud(none.hud);
    expect([none.rec.count('sfx.newBest'), none.hud.newBest]).toEqual([0, false]);
  });

  test('次の手番は、返りきった後の知らせを待たない。終局する手だけは、知らせを出しきってから終わる', () => {
    const kit = started({ bestScore: 1 });
    const { end, choreo, start } = kit.play(parseSquare('f5'), { combo: 5 });
    expect(end).toBeCloseTo(start + choreo.end, 9);
    kit.until(20);
    expect(kit.rec.calls('sfx.newBest')[0].world).toBeGreaterThan(end);

    // 黒が c4 に打つと白が 0 になって終局する
    const last = started({ start: SEVEN, bestScore: 1 });
    const r = last.play(parseSquare('c4'), { combo: 5 });
    last.until(r.end);
    for (const n of ['sfx.score', 'sfx.newBest']) {
      const calls = last.rec.calls(n);
      expect(calls).toHaveLength(1);
      expect(calls[0].world).toBeLessThanOrEqual(r.end);
    }
  });

  test('角を取った人の手は、専用の音と文字を出す', () => {
    const corner = positionFromRows(['.OX.....', '........', '........', '........', '........', '........', '........', '........'], BLACK);
    const kit = started({ start: corner });
    const { choreo, start } = kit.play(parseSquare('a1'));
    kit.until(start + choreo.end);
    expect(kit.rec.count('sfx.corner')).toBe(1);
    expect(kit.callouts.some((c) => c.kind === 'corner')).toBe(true);
  });
});

describe('Director の時間割', () => {
  test('大きな人の手は、落ちる音 → 着いた瞬間の打撃・コンボ・光・振動・溜め → 返り始め → 1 まとまりごとの数え上げ → 得点 → 更新の順に出す', () => {
    const kit = started({ start: SEVEN, bestScore: 1 });
    const r = kit.play(parseSquare('c4'), { combo: 5 });
    kit.until(r.end + 1);
    const flips = r.choreo.steps.flatMap(() => ['sfx.flipStep', 'callout']);
    expect(names(kit)).toEqual([
      'sfx.swoosh',
      'sfx.place',
      'sfx.combo',
      'callout',
      'flash.request',
      'vibrate',
      'audio.silence',
      'sfx.inhale',
      'sfx.burst',
      'flash.request',
      'vibrate',
      ...flips,
      'sfx.score',
      'callout',
      'sfx.newBest',
      'flash.request',
      'vibrate',
    ]);
    expect(kit.callouts.map((c): string => c.kind)).toEqual(['combo', ...r.choreo.steps.map(() => 'flips'), 'score']);
  });

  test('CPU の手は、重い着地 → 不穏な和音 → 下がっていく返る音だけで、光・振動・文字を出さない', () => {
    const kit = started({ setup: { human: WHITE }, start: SEVEN, bestScore: 1 });
    const r = kit.play(parseSquare('c4'));
    kit.until(r.end + 1);
    expect(names(kit)).toEqual(['sfx.place', 'sfx.dread', ...r.choreo.steps.map(() => 'sfx.flipStep')]);
    expect(kit.rec.calls('sfx.place')[0].args).toEqual(['cpu', flipTier(7)]);
    expect(kit.fx.flash).toBe(0);
    expect(kit.fx.dread).toBeGreaterThan(0);
    // 粒は、下へ落ちるか、その場で広がるだけ（上へ弾けない）
    expect(kit.particles.specs.every((p) => p.vy <= 0 || p.gravity === 0)).toBe(true);
  });
});

describe('Director の光', () => {
  test('1 回の光ごとに FlashLimiter の許可を 1 回だけ求め、角を取る大きな手でも返り始めの閃光が出る', () => {
    const kit = started({ start: CORNER_BIG });
    const { choreo, start } = kit.play(parseSquare('a1'));
    expect(choreo.tier).toBe(3);
    let before = 0;
    for (let i = 0; i < 600 && kit.ft.world < start + choreo.waveAt; i++) {
      before = kit.fx.flash;
      kit.frame();
    }
    // 返り始めたフレームで、大きな手の閃光が出る（そのフレームの減衰を 1 回受けた値）
    expect(kit.fx.flash).toBeGreaterThan(before);
    expect(kit.fx.flash).toBeGreaterThan(LOOK.flash * LOOK.moments.bigFlash.big * 0.8);
    kit.until(start + choreo.end);
    // 着いたとき（ヒットストップの閃光と角の bloom）と、返り始め（大きな手の閃光と bloom）で 1 回ずつ
    expect(kit.rec.calls('flash.request').map((c) => c.args[0])).toEqual([true, true]);
  });
});

describe('Director の大きな手', () => {
  test('スローモーションは、返り始めから最後の石が返りきるまでの世界時間の cover の割合を覆う', () => {
    const kit = started({ start: BIG });
    const { choreo, start } = kit.play(parseSquare('a2'));
    expect(choreo.tier).toBe(4);
    const from = start + choreo.waveAt;
    const to = from + (choreo.lastLandAt - choreo.waveAt) * SLOW_MO.cover;
    kit.until(from);
    const rates: number[] = [];
    for (let i = 0; i < 60 * 10 && kit.ft.world < to - 1 / 60; i++) {
      kit.frame();
      if (kit.ft.world > from + 1 / 60) rates.push(kit.ft.worldDt / kit.ft.realDt);
    }
    expect(rates.length).toBeGreaterThan(10);
    for (const r of rates) expect(r).toBeCloseTo(SLOW_MO.scale.top, 6);
  });

  test('捨てると、溜めの無音を解く', () => {
    const kit = started({ start: BIG });
    const { choreo, start } = kit.play(parseSquare('a2'));
    kit.until(start + choreo.landAt);
    expect(kit.rec.count('audio.silence')).toBe(1);
    kit.director.dispose();
    expect(kit.rec.count('audio.cancelSilence')).toBe(1);
  });
});

describe('Director の終局の儀式', () => {
  /** 人（黒）3・CPU（白）2 の盤 */
  const HUMAN_AHEAD = ['XXX.....', 'OO......', '........', '........', '........', '........', '........', '........'];
  /** 人（黒）2・CPU（白）3 の盤 */
  const HUMAN_BEHIND = ['XX......', 'OOO.....', '........', '........', '........', '........', '........', '........'];

  const win = (over: Partial<RunResult> = {}): RunResult =>
    runResult({ outcome: 'win', human: 3, cpu: 2, maxCombo: 1, score: sheetOf({ moves: 100, discs: 3, won: true, perfect: false, maxCombo: 1 }), ...over });
  const lose = (): RunResult => runResult({ outcome: 'lose', human: 2, cpu: 3, maxCombo: 1, score: sheetOf({ moves: 100, discs: 2, won: false, perfect: false, maxCombo: 1 }) });

  /** rows の盤で、結果 r の儀式を始めたキット */
  function ending(r: RunResult, rows: readonly string[]): DirectorKit {
    const kit = started();
    kit.discs.setPosition(positionFromRows(rows, BLACK));
    kit.director.ending(r, kit.ft);
    return kit;
  }

  /** 暗くし始めた present の時刻（暗くしていないマスは除く） */
  const dimmed = (kit: DirectorKit): [number, number][] => {
    const out: [number, number][] = [];
    for (let s = 0; s < 64; s++) {
      const at = kit.discs.data[s * DISC_STRIDE + DISC_OFFSET.dimAt];
      if (at > LONG_AGO) out.push([s, at]);
    }
    return out;
  };

  test('石を 1 組ずつ数え、多い側だけが続けて、決着の和音を 1 回鳴らし、終わったフレームで 1 回だけ知らせる', () => {
    const kit = ending(win(), HUMAN_AHEAD);
    kit.until(20);
    expect(kit.rec.calls('sfx.countTick').map((c) => c.args)).toEqual([
      ['human', 0, false, true],
      ['cpu', 0, false, true],
      ['human', 1, false, true],
      ['cpu', 1, false, true],
      ['human', 2, true, true],
    ]);
    expect(kit.rec.calls('sfx.verdict').map((c) => c.args)).toEqual([['win', false]]);
    expect(kit.rec.count('sfx.inhale')).toBe(1);
    expect(kit.particles.count).toBeGreaterThan(0);
    expect(kit.finished).toBe(1);
    expect([kit.hud.black, kit.hud.white]).toEqual([3, 2]);
  });

  test('全部の石が一度に跳ねてから、1 組ずつ消え、間を置いて並べ直す位置に現れた瞬間にその組を数える。組の間隔はだんだん短くなる', () => {
    expect(CEREMONY.warp.travel).toBeGreaterThan(0);
    const kit = ending(win(), HUMAN_AHEAD);
    const t0 = kit.ft.world;
    const p0 = kit.ft.present;
    expect(kit.rec.calls('sfx.gatherLift').map((c) => c.args)).toEqual([[CEREMONY.lift, true]]);
    // DiscField には、石ごとに移し始める時刻だけを書く（消える・移る・現れるの区切りは、シェーダーが CEREMONY.warp から決める）。
    // 同じ組の人の石と CPU の石は同時に移し始める
    const startOf = (rows: number, cols: number) => kit.discs.data[(rows * 8 + cols) * DISC_STRIDE + DISC_OFFSET.moveStart];
    const humanStarts = [startOf(0, 0), startOf(0, 1), startOf(0, 2)];
    const cpuStarts = [startOf(7, 7), startOf(7, 6)];
    expect(humanStarts[0]).toBeCloseTo(p0 + CEREMONY.lift, 6);
    expect(cpuStarts).toEqual(humanStarts.slice(0, 2));
    kit.until(30);
    // 1 組ごとに 1 回消える音を鳴らし、その組は WARP_ARRIVE 後に現れて数える
    const vanishes = kit.rec.calls('sfx.vanish').map((c) => c.world);
    expect(vanishes).toHaveLength(3);
    expect(vanishes[0]).toBeCloseTo(t0 + CEREMONY.lift, 1);
    const ticks = kit.rec.calls('sfx.countTick');
    const humanTicks = ticks.filter((c) => c.args[0] === 'human').map((c) => c.world);
    humanTicks.forEach((w, i) => expect(w - vanishes[i]).toBeCloseTo(WARP_ARRIVE, 1));
    // 最初の組が現れるより前に、次の組は消え始めている（移動と数え上げが重なって進む）
    expect(vanishes[1]).toBeLessThan(humanTicks[0]);
    expect(humanStarts[2] - humanStarts[1]).toBeLessThan(humanStarts[1] - humanStarts[0]);
  });

  test('人の石を数えるたびに集計を 1 つずつ増やし、HUD の得点に石の点を入れて、決着を出す', () => {
    const r = win({ maxCombo: 4, score: sheetOf({ moves: 0, discs: 3, won: true, perfect: false, maxCombo: 4 }) });
    const kit = ending(r, HUMAN_AHEAD);
    kit.until(30);
    // 1 組数えるたびに、人と CPU の両方の数を知らせる
    expect(kit.callouts.flatMap((c) => (c.kind === 'tally' ? [[c.human, c.cpu, c.final]] : []))).toEqual([
      [1, 1, false],
      [2, 2, false],
      [3, 2, true],
    ]);
    expect(kit.callouts.filter((c) => c.kind === 'verdict')).toEqual([{ kind: 'verdict', outcome: 'win', perfect: false }]);
    expect(kit.hud.score).toBe(r.score.discPoints);
  });

  test('CPU の石だけが残った最後の組も、CPU の数を増やし、人の数はそのままで数え終えたことを知らせる', () => {
    const kit = ending(lose(), HUMAN_BEHIND);
    kit.until(30);
    expect(kit.callouts.flatMap((c) => (c.kind === 'tally' ? [[c.human, c.cpu, c.final]] : []))).toEqual([
      [1, 1, false],
      [2, 2, false],
      [2, 3, true],
    ]);
  });

  test('数え終えてから、集計を見せておく間と無音の溜めを置いて決着を出す', () => {
    const kit = ending(win(), HUMAN_AHEAD);
    kit.until(30);
    const lastCount = kit.rec.calls('sfx.countTick').at(-1)?.world ?? NaN;
    const hush = kit.rec.calls('audio.silence')[0].world;
    const verdict = kit.rec.calls('sfx.verdict')[0].world;
    expect(hush - lastCount).toBeCloseTo(CEREMONY.countHold, 1);
    expect(verdict - hush).toBeCloseTo(CEREMONY.hush, 1);
  });

  test('パーフェクトの決着の 2 重の輪と、締めの波の輪は、別々の衝撃波として重なる', () => {
    const r = win({ human: 3, cpu: 0, perfect: true, score: sheetOf({ moves: 100, discs: 3, won: true, perfect: true, maxCombo: 1 }) });
    const kit = ending(r, ['XXX.....', ...HUMAN_AHEAD.slice(1).map(() => '........')]);
    kit.until(30);
    const waves: [number, number][] = [];
    const w = kit.fx.shockwaves;
    for (let i = 0; i < w.length / 4; i++) if (w[i * 4 + 2] > LONG_AGO) waves.push([w[i * 4 + 2], w[i * 4 + 3]]);
    waves.sort((a, b) => a[0] - b[0]);
    const verdictAt = waves[0][0];
    expect(waves.map(([, speed]) => speed)).toEqual([CEREMONY_MOTION.win.shockSpeed, CEREMONY_MOTION.perfect.shockSpeed, CEREMONY_MOTION.wave.shockSpeed]);
    expect(waves[1][0] - verdictAt).toBeCloseTo(CEREMONY_MOTION.perfect.delay, 6);
    expect(waves[2][0] - verdictAt).toBeCloseTo(CEREMONY.waveLead, 1);
  });

  test('負けには明るい光も外へ弾ける粒も、上がっていく音も、演出の強さの上乗せも付けない', () => {
    const kit = ending(lose(), HUMAN_BEHIND);
    let maxIntensity = 0;
    for (let i = 0; i < 60 * 20; i++) {
      kit.frame();
      maxIntensity = Math.max(maxIntensity, kit.fx.intensity);
    }
    expect(kit.rec.calls('sfx.verdict').map((c) => c.args)).toEqual([['lose', false]]);
    expect(kit.rec.count('audio.silence')).toBe(1);
    expect(kit.rec.count('sfx.inhale')).toBe(0);
    expect(kit.rec.count('sfx.swoosh')).toBe(0);
    // 儀式の音は、どれも上がらない版（最後の引数 rising が false）
    for (const name of ['sfx.gatherLift', 'sfx.countTick']) {
      const calls = kit.rec.calls(name);
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(c.args.at(-1)).toBe(false);
    }
    expect(kit.rec.count('flash.request')).toBe(0);
    expect(kit.fx.flash).toBe(0);
    expect(maxIntensity).toBe(0);
    expect(kit.particles.count).toBe(0);
    expect(kit.rec.count('vibrate')).toBe(0);
  });

  test('勝ちの締めの波で盤の線を虹色に回す。負けでは回さない', () => {
    const rainbowOf = (r: RunResult, rows: readonly string[]): number => {
      const kit = ending(r, rows);
      let max = 0;
      for (let i = 0; i < 60 * 20; i++) {
        kit.frame();
        max = Math.max(max, kit.fx.rainbow);
      }
      return max;
    };
    expect(rainbowOf(win(), HUMAN_AHEAD)).toBeGreaterThan(0.5);
    expect(rainbowOf(lose(), HUMAN_BEHIND)).toBe(0);
    const perfect = win({ human: 3, cpu: 0, perfect: true, score: sheetOf({ moves: 100, discs: 3, won: true, perfect: true, maxCombo: 1 }) });
    expect(rainbowOf(perfect, ['XXX.....', ...HUMAN_AHEAD.slice(1).map(() => '........')])).toBeGreaterThan(0.5);
  });

  test('引き分けは、上がっていく音も光も粒も付けず、無音で溜めてから宙に浮いた和音を鳴らす', () => {
    const draw = runResult({ outcome: 'draw', human: 2, cpu: 2, maxCombo: 1, score: sheetOf({ moves: 100, discs: 2, won: false, perfect: false, maxCombo: 1 }) });
    const kit = ending(draw, ['XX......', 'OO......', '........', '........', '........', '........', '........', '........']);
    kit.until(30);
    expect(kit.rec.calls('sfx.verdict').map((c) => c.args)).toEqual([['draw', false]]);
    expect([kit.rec.count('audio.silence'), kit.rec.count('sfx.inhale'), kit.rec.count('flash.request'), kit.rec.count('vibrate')]).toEqual([1, 0, 0, 0]);
    for (const name of ['sfx.gatherLift', 'sfx.countTick']) for (const c of kit.rec.calls(name)) expect(c.args.at(-1)).toBe(false);
    expect(kit.particles.count).toBe(0);
    expect(dimmed(kit)).toEqual([]);
    expect(kit.finished).toBe(1);
  });

  test('決着の後に飛ばしても、負けた側の石は暗くし始めた時刻のまま暗い', () => {
    const kit = ending(lose(), HUMAN_BEHIND);
    for (let i = 0; i < 60 * 20 && kit.rec.count('sfx.verdict') === 0; i++) kit.frame();
    const before = dimmed(kit);
    // 盤にある人（黒）の石 2 つ
    expect(before).toHaveLength(2);
    expect(kit.director.skip()).toBe(true);
    expect(dimmed(kit)).toEqual(before);
  });

  test('決着の前に飛ばしても、儀式を終えた盤と同じく負けた側の石を暗くする。引き分けは暗くしない', () => {
    const kit = ending(lose(), HUMAN_BEHIND);
    for (let i = 0; i < 10; i++) kit.frame();
    expect(dimmed(kit)).toEqual([]);
    expect(kit.director.skip()).toBe(true);
    // 並べ直した人（黒）の石 2 つを、飛ばしたフレームの時刻から暗くする
    const now = Math.fround(kit.ft.present);
    expect(dimmed(kit)).toEqual([
      [0, now],
      [1, now],
    ]);

    const draw = runResult({ outcome: 'draw', human: 2, cpu: 2, maxCombo: 1, score: sheetOf({ moves: 100, discs: 2, won: false, perfect: false, maxCombo: 1 }) });
    const even = ending(draw, ['XX......', 'OO......', '........', '........', '........', '........', '........', '........']);
    even.frame();
    even.director.skip();
    expect(dimmed(even)).toEqual([]);
  });

  test('溜めの間に飛ばすと、数えきった状態ですぐに終わり、溜めの無音と吸い込む音を止める', () => {
    const r = win();
    const kit = ending(r, HUMAN_AHEAD);
    for (let i = 0; i < 60 * 20 && kit.rec.count('audio.silence') === 0; i++) kit.frame();
    expect([kit.rec.count('audio.silence'), kit.rec.count('sfx.inhale')]).toEqual([1, 1]);
    expect(kit.director.skip()).toBe(true);
    expect([kit.rec.count('audio.cancelSilence'), kit.rec.count('sfx.inhale.stop')]).toEqual([1, 1]);
    kit.director.hud(kit.hud);
    expect([kit.hud.black, kit.hud.white]).toEqual([3, 2]);
    // 飛ばしても、HUD の得点には石の点まで入る
    expect(kit.hud.score).toBe(r.score.discPoints);
    expect(kit.director.skip()).toBe(false);
  });

  test('溜めの前に飛ばすと、その後に無音も吸い込む音も始まらない', () => {
    const kit = ending(win(), HUMAN_AHEAD);
    kit.frame();
    expect(kit.director.skip()).toBe(true);
    for (let i = 0; i < 60 * 10; i++) kit.frame();
    expect([kit.rec.count('audio.silence'), kit.rec.count('sfx.inhale'), kit.rec.count('sfx.verdict')]).toEqual([0, 0, 0]);
  });

  test('儀式を始めると、フィーバーの光を止める', () => {
    const kit = started();
    kit.director.setFever(1);
    for (let i = 0; i < 120; i++) kit.frame();
    expect(kit.fx.fever).toBeGreaterThan(0.9);
    kit.discs.setPosition(positionFromRows(HUMAN_AHEAD, BLACK));
    kit.director.ending(win(), kit.ft);
    for (let i = 0; i < 240; i++) kit.frame();
    expect(kit.fx.fever).toBeLessThan(0.01);
  });
});
