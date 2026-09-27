import { describe, expect, test } from 'bun:test';
import { QUALITY_LEVELS, QualityGovernor, snapInterval } from './quality.ts';

const MAX = QUALITY_LEVELS.length - 1;

function calibrated(interval: number): QualityGovernor {
  const g = new QualityGovernor(MAX);
  for (let i = 0; i < 100 && !g.calibrate(interval); i++);
  expect(g.calibrated).toBe(true);
  return g;
}

/** seconds 秒ぶん、段階に応じたフレーム間隔で描画したフレームを渡す。段階が変わった回数を返す */
function run(g: QualityGovernor, seconds: number, interval: (level: number) => number, rendered = true): number {
  let t = 0;
  let changes = 0;
  while (t < seconds) {
    const dt = interval(g.level);
    if (g.sample(dt, rendered)) changes++;
    t += dt;
  }
  return changes;
}

describe('snapInterval', () => {
  test('標準の間隔に寄せ、離れすぎていれば 0', () => {
    expect(snapInterval(0.0169, 0.1)).toBe(1 / 60);
    expect(snapInterval(0.0082, 0.1)).toBe(1 / 120);
    expect(snapInterval(0.034, 0.1)).toBe(1 / 30);
    expect(snapInterval(0.025, 0.1)).toBe(0);
  });
});

describe('QualityGovernor のリフレッシュ間隔の実測', () => {
  test('何も描かないフレームの中央値を標準の間隔に寄せる', () => {
    const g = new QualityGovernor(MAX);
    const jitter = [0.0162, 0.0171, 0.0166, 0.0168, 0.0165];
    for (let i = 0; i < 29; i++) expect(g.calibrate(jitter[i % jitter.length])).toBe(false);
    expect(g.calibrate(0.0167)).toBe(true);
    expect(g.target).toBe(1 / 60);
  });

  test('長い間隔と 0 は数えない', () => {
    const g = new QualityGovernor(MAX);
    for (let i = 0; i < 29; i++) g.calibrate(1 / 120);
    expect(g.calibrate(0.5)).toBe(false);
    expect(g.calibrate(0)).toBe(false);
    expect(g.calibrate(1 / 120)).toBe(true);
    expect(g.target).toBe(1 / 120);
  });

  test('実測が済むまでは段階を変えない', () => {
    const g = new QualityGovernor(MAX);
    expect(run(g, 10, () => 0.05)).toBe(0);
    expect(g.level).toBe(0);
  });
});

describe('QualityGovernor の段階の調整', () => {
  test('描画が重くて 40fps の端末（60Hz）は段階を下げる', () => {
    const g = calibrated(1 / 60);
    // 段階 2 で 60fps に届く
    const cost = [0.025, 0.024, 1 / 60, 1 / 60, 1 / 60];
    run(g, 20, (l) => cost[l]);
    expect(g.level).toBeGreaterThanOrEqual(2);
    // 上げ直しに失敗するたびに待ち時間が倍になるので、長く回しても行き来の回数は少ない
    const changes = run(g, 600, (l) => cost[l]);
    expect(changes).toBeLessThanOrEqual(12);
    expect(g.level).toBeGreaterThanOrEqual(2);
  });

  test('120Hz の画面で 40fps しか出ない端末も段階を下げる', () => {
    const g = calibrated(1 / 120);
    const cost = [0.025, 0.02, 0.014, 0.0095, 1 / 120];
    run(g, 30, (l) => cost[l]);
    expect(g.level).toBeGreaterThanOrEqual(3);
  });

  test('垂直同期で 30fps に落ちている端末は、60fps に届く段階まで下げる', () => {
    const g = calibrated(1 / 60);
    // 段階 0・1 では 60Hz の 2 フレームに 1 回しか間に合わない
    const cost = [1 / 30, 1 / 30, 1 / 60, 1 / 60, 1 / 60];
    run(g, 20, (l) => cost[l]);
    expect(g.level).toBe(2);
    expect(g.target).toBe(1 / 60);
  });

  test('省電力モードで 30fps に固定されても、最低の段階に張り付かない', () => {
    const g = calibrated(1 / 60);
    // どの段階でも 30fps（端末側の上限）
    run(g, 60, () => 1 / 30);
    expect(g.level).toBe(0);
    expect(g.target).toBe(1 / 30);
    // 以後は 30fps を基準に判定し、段階を変えない
    expect(run(g, 120, () => 1 / 30)).toBe(0);
  });

  test('省電力モードが解けたら、描画しないフレームから目標を 60Hz へ戻す', () => {
    const g = calibrated(1 / 60);
    run(g, 60, () => 1 / 30);
    expect(g.target).toBe(1 / 30);
    run(g, 2, () => 1 / 60, false);
    expect(g.target).toBe(1 / 60);
  });

  test('描画しないフレームでは段階を変えない', () => {
    const g = calibrated(1 / 60);
    expect(run(g, 30, () => 0.05, false)).toBe(0);
    expect(g.level).toBe(0);
  });

  test('一時的に重くなっても、軽くなれば元の段階へ戻る', () => {
    const g = calibrated(1 / 60);
    run(g, 3, () => 0.05);
    expect(g.level).toBeGreaterThan(0);
    run(g, 120, () => 1 / 60);
    expect(g.level).toBe(0);
  });

  test('重い時間が何度来ても、そのたびに元の段階へ戻る', () => {
    const g = calibrated(1 / 60);
    for (let i = 0; i < 5; i++) {
      run(g, 3, () => 0.05);
      expect(g.level).toBeGreaterThan(0);
      run(g, 300, () => 1 / 60);
      expect(g.level).toBe(0);
    }
  });

  test('0.25 秒を超える間隔は無視する', () => {
    const g = calibrated(1 / 60);
    for (let i = 0; i < 100; i++) expect(g.sample(1, true)).toBe(false);
    expect(g.level).toBe(0);
  });

  test('最低の段階より下へは下げない', () => {
    const g = calibrated(1 / 60);
    run(g, 120, () => 0.2);
    expect(g.level).toBe(MAX);
  });
});
