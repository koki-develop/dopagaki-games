import { describe, expect, test } from 'bun:test';
import type { FrameTime } from '../../../juice/frame-time.ts';
import { FlashLimiter } from '../../../juice/flash.ts';
import { Atmosphere } from './atmosphere.ts';
import type { BgmPort } from './atmosphere.ts';
import { createFxState } from './fx-state.ts';

const bgm: BgmPort = { setTier: () => {}, setRiser: () => {}, beatPosition: () => 0 };
const flashes = () => new FlashLimiter(3, 1);

/** 空気を dt 秒ずつ frames フレーム進め、各フレームの虹色の回った量を返す */
function run(atmosphere: Atmosphere, ft: FrameTime, frames: number, dt = 1 / 60): number[] {
  const fx = createFxState();
  const turns: number[] = [];
  for (let i = 0; i < frames; i++) {
    ft.realDt = dt;
    ft.worldDt = dt;
    ft.real += dt;
    ft.world += dt;
    ft.present += dt;
    atmosphere.update(ft, fx);
    turns.push(fx.rainbowTurns);
  }
  return turns;
}

const frameTime = (at: number): FrameTime => ({ realDt: 0, worldDt: 0, real: at, world: at, present: at });

describe('Atmosphere の虹色', () => {
  test('色相の回る速さは虹色の強さだけで決まり、それまでに経った時間によらない', () => {
    const early = new Atmosphere(bgm, flashes());
    const late = new Atmosphere(bgm, flashes());
    early.prism(1);
    late.prism(1);
    const a = run(early, frameTime(0), 120);
    const b = run(late, frameTime(900), 120);
    expect(b).toEqual(a);
    // 1 フレームで回る量は、強さ 1 の速さ（0.6 周 / 秒）を超えない
    for (let i = 1; i < a.length; i++) {
      const step = a[i] - a[i - 1];
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThanOrEqual(0.6 / 60 + 1e-12);
    }
  });

  test('回った量は 0 以上 3 未満に折り返し、虹色が消えると止まる', () => {
    const atmosphere = new Atmosphere(bgm, flashes());
    const ft = frameTime(0);
    for (let i = 0; i < 20; i++) {
      atmosphere.prism(1);
      for (const t of run(atmosphere, ft, 60)) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThan(3);
      }
    }
    run(atmosphere, ft, 60 * 60);
    const [x, y] = run(atmosphere, ft, 2);
    expect(Math.abs(y - x)).toBeLessThan(1e-9);
  });
});

describe('Atmosphere の光', () => {
  test('1 回の光は、画面全体のフラッシュと bloom のブーストを 1 回の許可で出す', () => {
    const limiter = new FlashLimiter(3, 1);
    let requests = 0;
    const atmosphere = new Atmosphere(bgm, {
      request: (now) => {
        requests++;
        return limiter.request(now);
      },
    });
    const fx = createFxState();
    const ft = frameTime(0);
    expect(atmosphere.flare(0, 0.4, 1)).toBe(true);
    ft.realDt = 1 / 60;
    atmosphere.update(ft, fx);
    expect(requests).toBe(1);
    expect(fx.flash).toBeGreaterThan(0.3);
    expect(fx.bloomStrength).toBeGreaterThan(createFxState().bloomStrength);
  });

  test('許可されなければ、フラッシュもブーストも出さない。光らない呼び出しは許可を使わない', () => {
    let requests = 0;
    const atmosphere = new Atmosphere(bgm, {
      request: () => {
        requests++;
        return false;
      },
    });
    const fx = createFxState();
    expect(atmosphere.flare(0, 0, 0)).toBe(false);
    expect(requests).toBe(0);
    expect(atmosphere.flare(0, 0.4, 1)).toBe(false);
    atmosphere.update({ ...frameTime(0), realDt: 1 / 60 }, fx);
    expect([fx.flash, fx.bloomStrength]).toEqual([0, createFxState().bloomStrength]);
  });
});

describe('Atmosphere の状態', () => {
  test('手番の色は滑らかに寄せ、CPU の重い手の暗さと放射状の光は時間とともに消える', () => {
    const atmosphere = new Atmosphere(bgm, flashes());
    const ft = frameTime(0);
    atmosphere.setTurn('cpu');
    atmosphere.darken(0.8);
    atmosphere.spreadRays(0.9);
    run(atmosphere, ft, 1);
    const fx = createFxState();
    const step = () => {
      ft.realDt = 1 / 60;
      ft.worldDt = 1 / 60;
      ft.real += 1 / 60;
      atmosphere.update(ft, fx);
    };
    step();
    expect(fx.turnTint).toBeLessThan(1);
    expect(fx.turnTint).toBeGreaterThan(0);
    for (let i = 0; i < 600; i++) step();
    expect(fx.turnTint).toBeLessThan(0.001);
    expect(fx.dread).toBeLessThan(0.01);
    expect(fx.rays).toBeLessThan(0.01);
  });

  test('ヒットストップの震えは、始めた実時間から長さのうちに弱まって 0 になり、集中線と RGB のずれも出す', () => {
    const atmosphere = new Atmosphere(bgm, flashes());
    const fx = createFxState();
    const ft = frameTime(10);
    atmosphere.hitStop(2, 3, 0.6, 0.2, 10);
    ft.realDt = 0;
    atmosphere.update(ft, fx);
    expect([fx.hitX, fx.hitY, fx.hitShake]).toEqual([2, 3, 0.6]);
    expect([fx.impactX, fx.impactY, fx.impactAt]).toEqual([2, 3, 10]);
    expect(fx.impactStrength).toBeCloseTo(1, 9);
    expect(fx.aberration).toBeGreaterThan(0);
    ft.real = 10.1;
    ft.realDt = 0.1;
    atmosphere.update(ft, fx);
    expect(fx.hitShake).toBeCloseTo(0.6 * 0.25, 9);
    ft.real = 10.25;
    atmosphere.update(ft, fx);
    expect(fx.hitShake).toBe(0);
  });

  test('BGM の段階は、盤の石の数からの段階にフィーバーで 1〜2 段を足し、いちばん上で止める。終盤の高まりは空きマスから', () => {
    const tiers: number[] = [];
    const risers: number[] = [];
    const port: BgmPort = { setTier: (t) => void tiers.push(t), setRiser: (r) => void risers.push(r), beatPosition: () => 0 };
    const atmosphere = new Atmosphere(port, flashes());
    const fx = createFxState();
    const ft = { ...frameTime(0), realDt: 1 / 60 };
    atmosphere.setProgress(1, 30);
    atmosphere.update(ft, fx);
    atmosphere.setFever(0.5);
    atmosphere.update(ft, fx);
    atmosphere.setFever(1);
    atmosphere.update(ft, fx);
    atmosphere.setProgress(3, 7);
    atmosphere.update(ft, fx);
    expect(tiers).toEqual([1, 2, 3, 3]);
    expect(risers).toEqual([0, 0, 0, 0.5 * 0.7]);
    // 終局で止めたら、その後は送らない
    atmosphere.muteRiser();
    atmosphere.update(ft, fx);
    expect(risers.slice(4)).toEqual([0]);
  });

  test('フィーバーでなければ、ビートの光は 0', () => {
    const atmosphere = new Atmosphere({ ...bgm, beatPosition: () => 3 }, flashes());
    const fx = createFxState();
    atmosphere.update({ ...frameTime(0), realDt: 1 / 60 }, fx);
    expect(fx.beat).toBe(0);
    atmosphere.setFever(1);
    for (let i = 0; i < 120; i++) atmosphere.update({ ...frameTime(0), realDt: 1 / 60 }, fx);
    expect(fx.beat).toBeGreaterThan(0.9);
  });
});
