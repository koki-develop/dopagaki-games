import { describe, expect, test } from 'bun:test';
import { MotionPreference } from './motion-preference.ts';
import type { MotionQuery } from './motion-preference.ts';
import { bindAudioSwitches, createGameSettings, shakeCameraMotion, sharedGameSettings, standardSettingsSchema } from './settings.ts';
import type { CameraMotion } from './camera.ts';
import type { AudioSwitches } from './audio/engine.ts';
import type { SettingsSchema } from './settings.ts';
import type { StorageLike } from './storage.ts';
import { memoryStorage } from './storage.test-support.ts';

const fakeQuery = (matches: boolean): MotionQuery & { fire(m: boolean): void } => {
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

type Values = { shake: boolean; sfx: boolean; bgm: boolean; hints: boolean };

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

const SCHEMA: SettingsSchema<Values> = {
  key: 'test:settings',
  version: 2,
  defaults: (reduced) => ({ shake: !reduced, sfx: true, bgm: true, hints: true }),
  sanitize: (saved, fallback) => ({
    shake: bool(saved.shake, fallback.shake),
    sfx: bool(saved.sfx, fallback.sfx),
    bgm: bool(saved.bgm, fallback.bgm),
    hints: bool(saved.hints, fallback.hints),
  }),
  cameraMotion: (s, reduced, out) => shakeCameraMotion(s.shake, reduced, out),
  audio: (s, out) => {
    out.sfx = s.sfx;
    out.bgm = s.bgm;
  },
};

const create = (storage: StorageLike | null = memoryStorage(), reduced = false) => {
  const query = fakeQuery(reduced);
  const motion = new MotionPreference(query);
  return { settings: createGameSettings(SCHEMA, { storage, motion }), query };
};

describe('MotionPreference', () => {
  test('問い合わせの結果と変化を知らせる。問い合わせられないときは動きを減らさない', () => {
    const q = fakeQuery(false);
    const m = new MotionPreference(q);
    let calls = 0;
    m.subscribe(() => calls++);
    expect(m.getReduced()).toBe(false);
    q.fire(true);
    expect([m.getReduced(), calls]).toEqual([true, 1]);
    expect(new MotionPreference(null).getReduced()).toBe(false);
  });
});

describe('createGameSettings', () => {
  test('何も保存されていなければ、既定値を使う。動きを減らす設定なら、画面の揺れの既定値はオフ', () => {
    expect(create().settings.get()).toEqual({ shake: true, sfx: true, bgm: true, hints: true });
    const reduced = create(memoryStorage(), true).settings;
    expect(reduced.get().shake).toBe(false);
    expect(reduced.cameraMotion).toEqual({ shake: 0, pulse: 0, pull: 0.3, punch: 0, jolt: 0 });
  });

  test('選んだ項目だけを保存し、同じ保存先から作り直すと読み戻す', () => {
    const storage = memoryStorage();
    create(storage).settings.update({ bgm: false, hints: false });
    expect(JSON.parse(storage.mem.get('test:settings') ?? '')).toEqual({ v: 2, bgm: false, hints: false });
    expect(create(storage).settings.get()).toEqual({ shake: true, sfx: true, bgm: false, hints: false });
  });

  test('カメラの動きと音の切り替えは、項目から決め、同じオブジェクトの中身を書き換える', () => {
    const { settings } = create();
    const motion = settings.cameraMotion;
    const audio = settings.audio;
    expect(motion).toEqual({ shake: 1, pulse: 1, pull: 1, punch: 1, jolt: 1 });
    expect(audio).toEqual({ sfx: true, bgm: true });
    settings.update({ shake: false, sfx: false });
    expect(settings.cameraMotion).toBe(motion);
    expect(settings.audio).toBe(audio);
    expect(motion).toEqual({ shake: 0, pulse: 0, pull: 1, punch: 0, jolt: 0 });
    expect(audio).toEqual({ sfx: false, bgm: true });
  });

  test('OS の「視差効果を減らす」が変わったら、カメラの動きを決め直して知らせる', () => {
    const { settings, query } = create();
    settings.update({ shake: true });
    let calls = 0;
    settings.subscribe(() => calls++);
    query.fire(true);
    expect(calls).toBe(1);
    expect(settings.cameraMotion).toEqual({ shake: 1, pulse: 0.3, pull: 0.3, punch: 0.3, jolt: 0.3 });
  });

  test('選んでいない項目は、OS の「視差効果を減らす」が途中で変わると既定値に従う。選んだ項目はそのまま', () => {
    const { settings, query } = create();
    const before = settings.get();
    query.fire(true);
    expect(settings.get().shake).toBe(false);
    expect(settings.get()).not.toBe(before);
    expect(settings.cameraMotion.shake).toBe(0);
    query.fire(false);
    expect(settings.get().shake).toBe(true);
    settings.update({ shake: true });
    query.fire(true);
    expect(settings.get().shake).toBe(true);
  });

  test('保存された壊れた項目は選んでいない扱いにする', () => {
    const storage = memoryStorage({ 'test:settings': JSON.stringify({ v: 2, shake: 'yes', sfx: false }) });
    const { settings, query } = create(storage);
    expect(settings.get()).toEqual({ shake: true, sfx: false, bgm: true, hints: true });
    query.fire(true);
    expect(settings.get().shake).toBe(false);
  });

  test('get() は値が変わるまで同じオブジェクトを返す', () => {
    const { settings } = create();
    const a = settings.get();
    expect(settings.get()).toBe(a);
    settings.update({ sfx: true });
    expect(settings.get()).toBe(a);
    settings.update({ sfx: false });
    expect(settings.get()).not.toBe(a);
  });

  test('版の違う保存内容と壊れた JSON は捨てて、既定値にする', () => {
    expect(create(memoryStorage({ 'test:settings': JSON.stringify({ v: 1, shake: false }) })).settings.get().shake).toBe(true);
    expect(create(memoryStorage({ 'test:settings': '{oops' })).settings.get()).toEqual({ shake: true, sfx: true, bgm: true, hints: true });
  });

  test('書き込めなくても、このタブの中では変えた値を使う。読み込みでは何も書き込まない', () => {
    let writes = 0;
    const full: StorageLike = {
      getItem: () => null,
      setItem: () => {
        writes++;
        throw new Error('QuotaExceededError');
      },
    };
    const { settings } = create(full);
    expect(writes).toBe(0);
    expect(() => settings.update({ sfx: false })).not.toThrow();
    expect(settings.get().sfx).toBe(false);
    expect(create(null).settings.get().sfx).toBe(true);
  });
});

describe('standardSettingsSchema', () => {
  const { schema, items } = standardSettingsSchema('game:settings');

  test('画面の揺れ・効果音・BGM の 3 項目。画面の揺れの既定値は、動きを減らす設定ならオフ', () => {
    expect(schema.key).toBe('game:settings');
    expect(items.map((i) => i.key)).toEqual(['shake', 'sfx', 'bgm']);
    expect(schema.defaults(false)).toEqual({ shake: true, sfx: true, bgm: true });
    expect(schema.defaults(true)).toEqual({ shake: false, sfx: true, bgm: true });
  });

  test('真偽値でない項目は fallback の値にし、知らない項目は取り込まない', () => {
    const fallback = { shake: true, sfx: true, bgm: false };
    expect(schema.sanitize({ shake: false, sfx: 'no', extra: 1 }, fallback)).toEqual({ shake: false, sfx: true, bgm: false });
  });

  test('画面の揺れと効果音・BGM から、カメラの動きと音の切り替えを決める', () => {
    const motion: CameraMotion = { shake: 9, pulse: 9, pull: 9, punch: 9, jolt: 9 };
    schema.cameraMotion({ shake: false, sfx: true, bgm: true }, false, motion);
    expect(motion).toEqual({ shake: 0, pulse: 0, pull: 1, punch: 0, jolt: 0 });
    schema.cameraMotion({ shake: true, sfx: true, bgm: true }, true, motion);
    expect(motion).toEqual({ shake: 1, pulse: 0.3, pull: 0.3, punch: 0.3, jolt: 0.3 });
    const audio: AudioSwitches = { sfx: true, bgm: true };
    schema.audio({ shake: true, sfx: false, bgm: true }, audio);
    expect(audio).toEqual({ sfx: false, bgm: true });
  });
});

describe('sharedGameSettings', () => {
  test('最初に呼んだときに 1 回だけ作り、以後は同じ設定を返す', () => {
    let envCalls = 0;
    const settings = sharedGameSettings(SCHEMA, () => {
      envCalls++;
      return { storage: memoryStorage(), motion: new MotionPreference(fakeQuery(false)) };
    });
    expect(envCalls).toBe(0);
    const a = settings();
    const b = settings();
    expect(a).toBe(b);
    expect(envCalls).toBe(1);
  });
});

describe('bindAudioSwitches', () => {
  test('今の切り替えをすぐに渡し、設定が変わるたびに渡し直して知らせる。返した関数でやめる', () => {
    const { settings } = create();
    const given: AudioSwitches[] = [];
    let changes = 0;
    const off = bindAudioSwitches(settings, { setEnabled: (s) => void given.push({ ...s }) }, () => changes++);
    expect(given).toEqual([{ sfx: true, bgm: true }]);
    settings.update({ bgm: false });
    expect(given.at(-1)).toEqual({ sfx: true, bgm: false });
    expect(changes).toBe(1);
    off();
    settings.update({ sfx: false });
    expect(given).toHaveLength(2);
    expect(changes).toBe(1);
  });
});
