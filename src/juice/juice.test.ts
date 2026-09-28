import { describe, expect, test } from 'bun:test';
import { octavePosition, pentatonicSemitones, shepardWeight } from './audio/shepard.ts';
import { SoundThrottle } from './audio/throttle.ts';
import { CameraRig } from './camera.ts';
import type { CameraOffset } from './camera.ts';
import { FlashLimiter } from './flash.ts';
import { EventRate } from './rate.ts';
import { defaultSettings, sanitizeSettings, SettingsStore } from './settings.ts';
import { WorldClock } from './time.ts';

describe('FlashLimiter', () => {
  test('どの 1 秒の区間にも 3 回を超えて許可しない', () => {
    const f = new FlashLimiter(3, 1);
    const granted: number[] = [];
    for (let t = 0; t <= 5; t += 0.05) {
      const now = Math.round(t * 100) / 100;
      if (f.request(now)) granted.push(now);
    }
    for (let i = 0; i + 3 < granted.length; i++) {
      expect(granted[i + 3] - granted[i]).toBeGreaterThan(1);
    }
    expect(granted.length).toBeGreaterThanOrEqual(12);
  });

  test('窓の境界ちょうどの記録も数える', () => {
    const f = new FlashLimiter(3, 1);
    expect(f.request(0)).toBe(true);
    expect(f.request(0.5)).toBe(true);
    expect(f.request(0.9)).toBe(true);
    expect(f.request(1.0)).toBe(false);
    expect(f.request(1.01)).toBe(true);
  });

  test('窓から外れた記録は数えない', () => {
    const f = new FlashLimiter(3, 1);
    f.request(0);
    f.request(0.2);
    f.request(0.5);
    expect(f.request(1.1)).toBe(true);
    expect(f.request(1.15)).toBe(false);
    expect(f.request(1.21)).toBe(true);
  });
});

describe('EventRate', () => {
  test('一定のペースで起き続けると、フレームレートによらずそのペースに収束する', () => {
    for (const hz of [30, 60, 120, 144]) {
      const r = new EventRate(0.5);
      // 1 秒に 90 回。フレームあたりの回数は小数でもよい
      for (let i = 0; i < hz * 10; i++) r.update(90 / hz, 1 / hz);
      expect(r.rate).toBeCloseTo(90, 6);
    }
  });

  test('止まると tau で減っていく', () => {
    const r = new EventRate(0.5);
    for (let i = 0; i < 600; i++) r.update(1, 1 / 60);
    const before = r.rate;
    for (let i = 0; i < 30; i++) r.update(0, 1 / 60);
    expect(r.rate / before).toBeCloseTo(Math.exp(-0.5 / 0.5), 6);
  });

  test('dt が 0 のフレームの回数も数え、dt → 0 の極限の値を返す', () => {
    const r = new EventRate(0.5);
    expect(r.update(3, 0)).toBeCloseTo(6, 9);
    const tiny = new EventRate(0.5);
    expect(tiny.update(3, 1e-9)).toBeCloseTo(6, 6);
    // 溜めた分は次のフレームにも残る
    const keep = Math.exp(-1 / 30);
    expect(r.update(0, 1 / 60)).toBeCloseTo(3 * keep * (1 - keep) * 60, 9);
  });
});

describe('WorldClock', () => {
  test('スローモーションは hold の間その倍率で、release の間に等速へ戻る', () => {
    const c = new WorldClock();
    c.slowMo(0.2, 0.5, 0.5);
    const first = c.advance(0.1);
    expect(first).toBeCloseTo(0.02, 9);
    for (let i = 0; i < 20; i++) c.advance(0.05);
    expect(c.advance(0.1)).toBeCloseTo(0.1, 9);
  });

  test('スローモーションが無ければ実時間と同じだけ進み、スローモーションは呼んだ時点の実時間から始まる', () => {
    const c = new WorldClock();
    expect(c.advance(0.5)).toBeCloseTo(0.5, 9);
    c.slowMo(0.5, 10, 0);
    expect(c.advance(0.5)).toBeCloseTo(0.25, 9);
  });

  test('重なったスローモーションは一番遅い倍率に従い、それぞれの長さが過ぎたら外れる', () => {
    const c = new WorldClock();
    c.slowMo(0.5, 1, 0);
    c.slowMo(0.1, 0.2, 0);
    expect(c.advance(0.1)).toBeCloseTo(0.01, 9);
    c.advance(0.2);
    expect(c.advance(0.1)).toBeCloseTo(0.05, 9);
    c.advance(1);
    expect(c.advance(0.1)).toBeCloseTo(0.1, 9);
  });

  test('release が Infinity なら戻さない', () => {
    const c = new WorldClock();
    c.slowMo(0.1, 0.2, Infinity);
    for (let i = 0; i < 100; i++) c.advance(0.1);
    expect(c.advance(0.1)).toBeCloseTo(0.01, 9);
  });
});

describe('CameraRig', () => {
  const opts = { maxOffset: 0.4, maxRotation: 0.05, decayPerSecond: 1, frequency: 20 };
  const out: CameraOffset = { x: 0, y: 0, rotation: 0, zoom: 1 };
  const full = { shake: 1, pulse: 1, pull: 1 };

  test('揺れは trauma² に比例し、揺れの倍率 0 なら揺れない', () => {
    const cam = new CameraRig(opts);
    cam.addTrauma(0.5);
    cam.update(0.013);
    let maxHalf = 0;
    for (let i = 0; i < 200; i++) {
      cam.trauma = 0.5;
      cam.update(0.01);
      cam.sample(full, out);
      maxHalf = Math.max(maxHalf, Math.abs(out.x));
    }
    expect(maxHalf).toBeLessThanOrEqual(opts.maxOffset * 0.25 + 1e-9);
    cam.sample({ ...full, shake: 0 }, out);
    expect(Math.abs(out.x)).toBe(0);
    expect(Math.abs(out.rotation)).toBe(0);
  });

  test('trauma は 1 を超えず、時間とともに線形に減る', () => {
    const cam = new CameraRig(opts);
    cam.addTrauma(0.8);
    cam.addTrauma(0.8);
    expect(cam.trauma).toBe(1);
    cam.update(0.25);
    expect(cam.trauma).toBeCloseTo(0.75, 9);
    cam.update(5);
    expect(cam.trauma).toBe(0);
  });

  test('引きはズームを下げてから 1 に戻る', () => {
    const cam = new CameraRig(opts);
    cam.pull(0.1, 0.1, 0.5);
    cam.update(0.1);
    cam.sample(full, out);
    expect(out.zoom).toBeCloseTo(0.9, 6);
    cam.update(0.6);
    cam.sample(full, out);
    expect(out.zoom).toBeCloseTo(1, 6);
    cam.pull(0.1, 0.1, 0.5);
    cam.update(0.1);
    cam.sample({ ...full, pull: 0.3 }, out);
    expect(out.zoom).toBeCloseTo(0.97, 6);
  });

  test('ビートの拍動は拍動の倍率だけで決まり、0 なら止まる。揺れと引きの倍率には左右されない', () => {
    const cam = new CameraRig(opts);
    cam.beatAmount = 0.012;
    cam.beatEnvelope = 1;
    cam.sample(full, out);
    expect(out.zoom).toBeCloseTo(1.012, 9);
    cam.sample({ shake: 0, pulse: 1, pull: 0 }, out);
    expect(out.zoom).toBeCloseTo(1.012, 9);
    cam.sample({ ...full, pulse: 0.3 }, out);
    expect(out.zoom).toBeCloseTo(1.0036, 9);
    cam.sample({ ...full, pulse: 0 }, out);
    expect(out.zoom).toBe(1);
  });
});

describe('Settings', () => {
  test('壊れた値は既定値に置き換える', () => {
    const d = defaultSettings(false);
    const s = sanitizeSettings({ shake: 'yes', sfx: false, bgm: 1 }, d);
    expect(s.shake).toBe(d.shake);
    expect(s.sfx).toBe(false);
    expect(s.bgm).toBe(d.bgm);
    expect(sanitizeSettings(null, d)).toEqual(d);
  });

  test('prefers-reduced-motion のときは画面の揺れの初期値がオフ', () => {
    expect(defaultSettings(true).shake).toBe(false);
    expect(defaultSettings(false).shake).toBe(true);
  });

  test('保存して読み直せる。保存に失敗してもプレイは続けられる', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      length: 0,
    } as Storage;
    const a = new SettingsStore(storage);
    a.update({ shake: false, bgm: false });
    const b = new SettingsStore(storage);
    expect(b.get()).toEqual({ shake: false, sfx: true, bgm: false });

    const broken = { ...storage, setItem: () => { throw new Error('quota'); } } as Storage;
    const c = new SettingsStore(broken);
    expect(() => c.update({ sfx: false })).not.toThrow();
    expect(c.get().sfx).toBe(false);
  });
});

describe('Shepard tone', () => {
  test('ペンタトニックは 5 音で 1 オクターブ上がる', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(pentatonicSemitones)).toEqual([0, 2, 4, 7, 9, 12, 14]);
  });

  test('12 半音上がると成分の組み合わせが元に戻る（無限に上がって聞こえる）', () => {
    const parts = (semitones: number) => {
      const h = octavePosition(semitones) / 12;
      return [0, 1, 2, 3].map((k) => ({ freq: 100 * 2 ** (k + h), amp: shepardWeight(k, h, 4) }));
    };
    expect(parts(15)).toEqual(parts(3));
    expect(parts(-9)).toEqual(parts(3));
  });
});

describe('SoundThrottle', () => {
  const opts = { minInterval: 0.08, rateTau: 0.5, halfGainRate: 12, minGain: 0.3 };

  test('毎フレーム起きても最短間隔より詰めて鳴らさず、間の回数をまとめる', () => {
    const t = new SoundThrottle(opts);
    const fired: number[] = [];
    let total = 0;
    for (let i = 0; i < 60; i++) {
      const count = t.update(i / 60, 1 / 60, 2);
      if (count > 0) {
        fired.push(i / 60);
        total += count;
      }
    }
    for (let i = 1; i < fired.length; i++) expect(fired[i] - fired[i - 1]).toBeGreaterThanOrEqual(opts.minInterval - 1e-9);
    // 最後に鳴らした後の分を除き、起きた回数はすべてどれかの音に含まれる
    expect(total).toBeGreaterThan(110);
    expect(total).toBeLessThanOrEqual(120);
  });

  test('頻度が高いほど 1 音を小さくし、下限は守る', () => {
    const slow = new SoundThrottle(opts);
    const fast = new SoundThrottle(opts);
    let slowGain = 1;
    let fastGain = 1;
    for (let i = 0; i < 120; i++) {
      if (slow.update(i / 60, 1 / 60, i % 30 === 0 ? 1 : 0) > 0) slowGain = slow.gain;
      if (fast.update(i / 60, 1 / 60, 8) > 0) fastGain = fast.gain;
    }
    // 1 秒に 2 回程度なら、ほぼそのままの大きさで鳴らす
    expect(slowGain).toBeGreaterThan(0.75);
    expect(fastGain).toBeLessThan(0.5);
    expect(fastGain).toBeGreaterThanOrEqual(opts.minGain);
  });

  test('同じ頻度なら、フレームレートによらず同じ音量にする', () => {
    const gains = [30, 60, 120].map((hz) => {
      const t = new SoundThrottle(opts);
      // 1 秒に halfGainRate 回。音量はちょうど半分になる
      for (let i = 0; i < hz * 10; i++) t.update(i / hz, 1 / hz, opts.halfGainRate / hz);
      return t.gain;
    });
    for (const g of gains) expect(g).toBeCloseTo(0.5, 6);
  });
});
