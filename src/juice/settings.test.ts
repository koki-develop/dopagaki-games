import { describe, expect, test } from 'bun:test';
import { SettingsStore } from './settings.ts';
import type { MotionQuery } from './settings.ts';
import type { StorageLike } from './storage.ts';

const memoryStorage = (init: Record<string, string> = {}): StorageLike & { mem: Map<string, string> } => {
  const mem = new Map(Object.entries(init));
  return {
    mem,
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
  };
};

const fakeMotion = (matches: boolean): MotionQuery & { fire(m: boolean): void } => {
  const listeners: ((e: { matches: boolean }) => void)[] = [];
  const q = {
    matches,
    addEventListener: (_: 'change', l: (e: { matches: boolean }) => void) => void listeners.push(l),
    fire(m: boolean) {
      q.matches = m;
      for (const l of listeners) l({ matches: m });
    },
  };
  return q;
};

describe('SettingsStore', () => {
  test('prefers-reduced-motion のときは、画面の揺れの初期値がオフになり、カメラの動きを弱める', () => {
    const s = new SettingsStore(memoryStorage(), fakeMotion(true));
    expect(s.get().shake).toBe(false);
    expect(s.cameraMotion).toEqual({ shake: 0, pulse: 0, pull: 0.3 });
    expect(new SettingsStore(memoryStorage(), fakeMotion(false)).get().shake).toBe(true);
    expect(new SettingsStore(memoryStorage(), null).cameraMotion).toEqual({ shake: 1, pulse: 1, pull: 1 });
  });

  test('画面の揺れをオフにすると、衝撃による揺れとビートの拍動が止まる。引きは止めない', () => {
    const s = new SettingsStore(memoryStorage(), fakeMotion(false));
    const motion = s.cameraMotion;
    expect(motion).toEqual({ shake: 1, pulse: 1, pull: 1 });
    s.update({ shake: false });
    expect(s.cameraMotion).toEqual({ shake: 0, pulse: 0, pull: 1 });
    // 毎フレーム読まれるので、同じオブジェクトの中身を書き換える
    expect(s.cameraMotion).toBe(motion);
    s.update({ shake: true });
    expect(s.cameraMotion).toEqual({ shake: 1, pulse: 1, pull: 1 });
  });

  test('prefers-reduced-motion で画面の揺れをオンにしたときは、拍動と引きを弱めて残す', () => {
    const s = new SettingsStore(memoryStorage(), fakeMotion(true));
    s.update({ shake: true });
    expect(s.cameraMotion).toEqual({ shake: 1, pulse: 0.3, pull: 0.3 });
  });

  test('保存済みの「画面の揺れ: オフ」を読み込んだときも、拍動を止める', () => {
    const s = new SettingsStore(memoryStorage({ 'dopagaki:settings': JSON.stringify({ shake: false, sfx: true, bgm: true }) }), fakeMotion(false));
    expect(s.cameraMotion).toEqual({ shake: 0, pulse: 0, pull: 1 });
  });

  test('prefers-reduced-motion の変化を購読者へ知らせる', () => {
    const q = fakeMotion(false);
    const s = new SettingsStore(memoryStorage(), q);
    let calls = 0;
    s.subscribe(() => calls++);
    expect(s.reducedMotion).toBe(false);
    q.fire(true);
    expect(calls).toBe(1);
    expect(s.reducedMotion).toBe(true);
    expect(s.cameraMotion).toEqual({ shake: 1, pulse: 0.3, pull: 0.3 });
    q.fire(false);
    expect(calls).toBe(2);
    expect(s.reducedMotion).toBe(false);
    expect(s.cameraMotion).toEqual({ shake: 1, pulse: 1, pull: 1 });
  });

  test('prefers-reduced-motion を問い合わせられないときは、動きを減らさない', () => {
    const s = new SettingsStore(memoryStorage(), null);
    expect(s.reducedMotion).toBe(false);
    expect(s.cameraMotion).toEqual({ shake: 1, pulse: 1, pull: 1 });
  });

  test('書き込めない（容量が一杯の）ときも、保存済みの値は読める', () => {
    const base = memoryStorage({ 'dopagaki:settings': JSON.stringify({ shake: false, sfx: false, bgm: true }) });
    const full: StorageLike = {
      getItem: base.getItem,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const s = new SettingsStore(full, null);
    expect(s.get()).toEqual({ shake: false, sfx: false, bgm: true });
    expect(() => s.update({ bgm: false })).not.toThrow();
    expect(s.get().bgm).toBe(false);
  });

  test('読み込みでは何も書き込まない', () => {
    const storage = memoryStorage();
    let writes = 0;
    new SettingsStore({ getItem: storage.getItem, setItem: () => void writes++ }, null);
    expect(writes).toBe(0);
  });

  test('壊れた JSON は既定値として読む', () => {
    const s = new SettingsStore(memoryStorage({ 'dopagaki:settings': '{oops' }), null);
    expect(s.get()).toEqual({ shake: true, sfx: true, bgm: true });
  });
});
