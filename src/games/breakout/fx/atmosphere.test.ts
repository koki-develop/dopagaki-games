import { describe, expect, test } from 'bun:test';
import { CameraRig } from '../../../juice/camera.ts';
import type { FrameTime } from '../frame-time.ts';
import { Sim } from '../sim/sim.ts';
import { LOOK } from '../view/look.ts';
import { emptyRows, line, simConfig, stageMode } from '../sim/sim.test-support.ts';
import { Atmosphere, FLASH_EPSILON, TIER_FALL_TAU, TIER_RISE_TAU } from './atmosphere.ts';
import { createFxState } from './fx-state.ts';
import { Recorder, recordingBgm } from './test-kit.test-support.ts';

function setup(sim: Sim, initialLive = sim.blocks.liveCount) {
  const rec = new Recorder();
  const bgm = recordingBgm(rec);
  const atm = new Atmosphere(bgm, initialLive);
  const camera = new CameraRig({ maxOffset: 0.3, maxRotation: 0.03, decayPerSecond: 1.2, frequency: 18 });
  const fx = createFxState(sim.mode.kind === 'endless', 0, 0);
  const ft: FrameTime = { realDt: 1 / 60, worldDt: 1 / 60, real: 0, world: 0, present: 0 };
  return {
    rec,
    bgm,
    atm,
    camera,
    fx,
    step(tier: number, intensity = 0, dt = 1 / 60) {
      ft.realDt = dt;
      ft.worldDt = dt;
      ft.real += dt;
      atm.update(ft, tier, intensity, sim, camera, fx);
    },
  };
}

const stageSim = () => new Sim({ mode: stageMode(emptyRows(10).concat([line(2, 'o')])), seed: 1, config: simConfig() });

describe('Atmosphere', () => {
  test('段階は上がるとき 1.5 秒、下がるとき 2 秒の時定数で寄せる', () => {
    const t = setup(stageSim());
    t.step(2, 0, TIER_RISE_TAU);
    expect(t.fx.tier).toBeCloseTo(2 * (1 - Math.exp(-1)), 9);
    const v = t.fx.tier;
    t.step(0, 0, TIER_FALL_TAU);
    expect(t.fx.tier).toBeCloseTo(v * Math.exp(-1), 9);
  });

  test('BGM へは毎フレーム今の段階を送る（同じ値の繰り返しは Bgm の側で無視する）', () => {
    const t = setup(stageSim());
    for (let i = 0; i < 3; i++) t.step(0);
    t.step(1);
    t.step(1);
    t.step(2);
    expect(t.rec.of('bgm.setTier').map((c) => c.args[0])).toEqual([0, 0, 0, 1, 1, 2]);
  });

  test('フラッシュは減衰し、FLASH_EPSILON を下回ったら 0 になる', () => {
    const t = setup(stageSim());
    t.atm.flashTo(0.55);
    t.step(0);
    expect(t.fx.flash).toBeCloseTo(0.55 * Math.exp(-9 / 60), 12);
    let frames = 0;
    while (t.fx.flash !== 0 && frames < 1000) {
      const before = t.fx.flash;
      t.step(0);
      frames++;
      if (t.fx.flash === 0) expect(before * Math.exp(-9 / 60)).toBeLessThan(FLASH_EPSILON);
    }
    expect(t.fx.flash).toBe(0);
  });

  test('bloom のブーストは強い方を残し、bloom の強さに上乗せする', () => {
    const t = setup(stageSim());
    t.atm.boostTo(1.1);
    t.atm.boostTo(0.8);
    t.step(0, 0, 1e-9);
    expect(t.fx.bloomStrength).toBeCloseTo(LOOK.bloom.base + 1.1 * LOOK.bloom.boost, 6);
    expect(t.fx.bloomRadius).toBeCloseTo(LOOK.bloom.radius, 9);
  });

  test('ビートの位置から拍の直後に 1 になる値を作り、段階 1.5 以上でカメラを拍動させる', () => {
    const t = setup(stageSim());
    t.bgm.beat = 3.25;
    t.step(0);
    expect(t.fx.beat).toBeCloseTo(Math.exp(-0.25 * 7), 12);
    expect(t.camera.beatEnvelope).toBe(t.fx.beat);
    expect(t.camera.beatAmount).toBe(0);
    for (let i = 0; i < 600; i++) t.step(4);
    expect(t.camera.beatAmount).toBeCloseTo(0.012, 6);
  });

  test('段階 2 以上で色相が回り、下がると一周の区切りへ戻る', () => {
    const t = setup(stageSim());
    for (let i = 0; i < 600; i++) t.step(3);
    expect(t.fx.hue).toBeGreaterThan(1);
    for (let i = 0; i < 1800; i++) t.step(0);
    const r = t.fx.hue / (Math.PI * 2);
    expect(Math.abs(r - Math.round(r))).toBeLessThan(0.01);
  });

  test('ライザーの音量はプレイ中に毎フレーム送り、ステージクリアで 0 に戻す', () => {
    // ブロックの残りが 1/4 を下回ると上がり始める
    const sim = new Sim({ mode: stageMode(emptyRows(10).concat([line(2, 'o')])), seed: 1, config: simConfig() });
    const t = setup(sim, 8);
    for (let i = 0; i < 60; i++) t.step(0);
    const sent = t.rec.of('bgm.setRiser').map((c) => c.args[0] as number);
    expect(sent.length).toBe(60);
    for (let i = 1; i < sent.length; i++) expect(sent[i]).toBeGreaterThan(sent[i - 1]);
    expect(t.fx.glow).toBeCloseTo(sent[59] * 0.8, 12);
    t.atm.resetRiser();
    expect(t.rec.of('bgm.setRiser').at(-1)?.args).toEqual([0]);
    t.step(0);
    expect(t.fx.glow).toBeLessThan(0.05);
  });

  test('ゲームオーバーでは音だけを消し、背景の輝度は残す', () => {
    const t = setup(stageSim());
    t.atm.muteRiser();
    expect(t.rec.of('bgm.setRiser').map((c) => c.args[0])).toEqual([0]);
  });

  test('エンドレスでは、ブロックが危険ラインに迫るほど danger が上がる', () => {
    const sim = new Sim({ mode: { kind: 'endless' }, seed: 1, config: simConfig() });
    const t = setup(sim);
    for (let i = 0; i < 120; i++) t.step(0);
    const lowest = sim.blocks.lowestLiveBlockBottom();
    const expected = Math.min(1, Math.max(0, 1 - (lowest - 4) / 4));
    expect(t.fx.danger).toBeCloseTo(expected, 3);
    expect(t.rec.count('bgm.setRiser')).toBe(0);
  });
});
