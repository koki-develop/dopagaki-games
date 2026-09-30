import type { AudioEngine, AudioSwitches } from './audio/engine.ts';
import type { CameraMotion } from './camera.ts';
import type { MotionPreference } from './motion-preference.ts';
import { createPersistentStore } from './persistent.ts';
import type { StorageLike } from './storage.ts';

/** 設定の項目の値。画面ではオン / オフなどの選択肢で切り替える */
export type SettingValues = Record<string, boolean>;

/** 設定の画面に並べる 1 項目 */
export type SettingItem<T extends SettingValues> = { key: keyof T & string; label: string };

/**
 * ゲームごとの設定の中身。項目、既定値、保存先、項目からカメラの動きと音を決める方法をゲームが決める。
 */
export type SettingsSchema<T extends SettingValues> = {
  /** 保存先のキー */
  key: string;
  /** 保存する形式の版。形式を変えるときは上げる。版の違う保存内容は読まない（createPersistentStore） */
  version: number;
  /** ユーザーが選んでいない項目の値。reducedMotion は OS の「視差効果を減らす」 */
  defaults(reducedMotion: boolean): T;
  /** 保存された内容を検証して取り込む。壊れた項目や知らない項目は fallback の値にする */
  sanitize(saved: Readonly<Record<string, unknown>>, fallback: T): T;
  /** 項目から、カメラの動きの種類ごとの倍率を決めて out に書く */
  cameraMotion(values: T, reducedMotion: boolean, out: CameraMotion): void;
  /** 項目から、効果音と BGM を鳴らすかを決めて out に書く */
  audio(values: T, out: AudioSwitches): void;
};

/** 1 つのゲームの設定。React からは useSyncExternalStore で、ゲームからは cameraMotion と audio を毎フレーム読む */
export interface GameSettings<T extends SettingValues> {
  /** 今の値。変わるまでは同じオブジェクトを返す */
  get(): T;
  /** 項目が変わったときと、OS の「視差効果を減らす」が変わったときに知らせる */
  subscribe(listener: () => void): () => void;
  /** 項目を選ぶ。選んだ項目は、OS の「視差効果を減らす」が変わっても既定値に戻らない */
  update(patch: Partial<T>): void;
  /** カメラの動きの種類ごとの倍率。変わると同じオブジェクトの中身が変わる */
  readonly cameraMotion: Readonly<CameraMotion>;
  /** 効果音と BGM を鳴らすか。変わると同じオブジェクトの中身が変わる */
  readonly audio: Readonly<AudioSwitches>;
}

/** ゲームのセッションが読む設定。GameSettings のうち、カメラの動きと音の切り替え */
export type SessionSettings = Pick<GameSettings<SettingValues>, 'cameraMotion' | 'audio' | 'subscribe'>;

/** 設定の効果音と BGM の切り替えを engine へ渡し、設定が変わるたびに渡し直して onChange を呼ぶ。返した関数でやめる */
export function bindAudioSwitches(settings: SessionSettings, engine: Pick<AudioEngine, 'setEnabled'>, onChange: () => void): () => void {
  engine.setEnabled(settings.audio);
  return settings.subscribe(() => {
    engine.setEnabled(settings.audio);
    onChange();
  });
}

/** `prefers-reduced-motion: reduce` のときの、カメラの引き・拍動・突き・画面の衝撃の倍率 */
const REDUCED_CAMERA_MOTION = 0.3;

/**
 * 「画面の揺れ」の 1 項目から決める、カメラの動きの倍率。
 * オフにすると、衝撃による揺れと、それに伴う引き・拍動・突き・画面の衝撃を止める。大きな節目の引きは止めない。
 * `prefers-reduced-motion: reduce` では、拍動・引き・突き・画面の衝撃を弱める。
 */
export function shakeCameraMotion(shake: boolean, reducedMotion: boolean, out: CameraMotion): void {
  const motion = reducedMotion ? REDUCED_CAMERA_MOTION : 1;
  out.shake = shake ? 1 : 0;
  out.pulse = shake ? motion : 0;
  out.pull = motion;
  out.punch = shake ? motion : 0;
  out.jolt = shake ? motion : 0;
}

/** 画面の揺れ・効果音・BGM の 3 項目の設定 */
export type StandardSettings = {
  /** 画面の揺れ。衝撃による揺れと、それに伴う引き・拍動・突き・画面の衝撃 */
  shake: boolean;
  /** 効果音 */
  sfx: boolean;
  /** BGM */
  bgm: boolean;
};

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** 画面の揺れ・効果音・BGM の設定の画面の項目 */
const STANDARD_ITEMS: readonly SettingItem<StandardSettings>[] = [
  { key: 'shake', label: '画面の揺れ' },
  { key: 'sfx', label: '効果音' },
  { key: 'bgm', label: 'BGM' },
];

/** 画面の揺れ・効果音・BGM の 3 項目の設定を保存する形式の版。形式を変えるときは上げる */
const STANDARD_SETTINGS_VERSION = 2;

/**
 * 画面の揺れ・効果音・BGM の 3 項目の設定の中身と、設定の画面の項目。key は保存先のキー。
 * 画面の揺れの既定値は、OS の「視差効果を減らす」ならオフ
 */
export function standardSettingsSchema(key: string): {
  schema: SettingsSchema<StandardSettings>;
  items: readonly SettingItem<StandardSettings>[];
} {
  return {
    schema: {
      key,
      version: STANDARD_SETTINGS_VERSION,
      defaults: (reducedMotion) => ({ shake: !reducedMotion, sfx: true, bgm: true }),
      sanitize: (saved, fallback) => ({
        shake: bool(saved.shake, fallback.shake),
        sfx: bool(saved.sfx, fallback.sfx),
        bgm: bool(saved.bgm, fallback.bgm),
      }),
      cameraMotion: (s, reducedMotion, out) => shakeCameraMotion(s.shake, reducedMotion, out),
      audio: (s, out) => {
        out.sfx = s.sfx;
        out.bgm = s.bgm;
      },
    },
    items: STANDARD_ITEMS,
  };
}

const sameOverrides = (a: Readonly<Record<string, boolean | undefined>>, b: Readonly<Record<string, boolean | undefined>>): boolean => {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
};

/**
 * ゲームの設定を作る。保存するのはユーザーが選んだ項目だけで、選んでいない項目は既定値に従う
 * （OS の「視差効果を減らす」が途中で変わると、既定値も変わる）。
 * 版つきで保存し、保存先が使えなくてもそのタブの中では値を使い続ける。
 * 別のタブで変えた設定は取り込まない（このタブで選んだ値を優先する）。
 */
export function createGameSettings<T extends SettingValues>(
  schema: SettingsSchema<T>,
  env: { storage: StorageLike | null; motion: MotionPreference },
): GameSettings<T> {
  const { storage, motion } = env;
  const store = createPersistentStore<Partial<T>>({
    key: schema.key,
    version: schema.version,
    storage,
    empty: () => ({}),
    sanitize: (saved) => {
      // 検証を通った値のうち、保存されていたものだけを選んだ項目として取り込む
      const valid = schema.sanitize(saved, schema.defaults(motion.getReduced()));
      const picked: Partial<T> = {};
      for (const k of Object.keys(valid) as (keyof T & string)[]) if (Object.hasOwn(saved, k) && saved[k] === valid[k]) picked[k] = valid[k];
      return picked;
    },
    same: sameOverrides,
    serialize: (overrides) => ({ ...overrides }),
  });

  const cameraMotion: CameraMotion = { shake: 1, pulse: 1, pull: 1, punch: 1, jolt: 1 };
  const audio: AudioSwitches = { sfx: true, bgm: true };
  let values: T = schema.defaults(motion.getReduced());
  const derive = () => {
    const reduced = motion.getReduced();
    const next: T = { ...schema.defaults(reduced), ...store.get() };
    if (!sameOverrides(values, next)) values = next;
    schema.cameraMotion(values, reduced, cameraMotion);
    schema.audio(values, audio);
  };
  derive();
  const listeners = new Set<() => void>();
  const emit = () => {
    derive();
    for (const l of listeners) l();
  };
  store.subscribe(emit);
  motion.subscribe(emit);

  return {
    get: () => values,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    update: (patch) => store.update((current) => ({ ...current, ...patch })),
    cameraMotion,
    audio,
  };
}

/**
 * ページで 1 つを共有するゲームの設定を返す関数。最初に呼んだときに env() の保存先と「視差効果を減らす」で
 * createGameSettings を作り、以後は同じものを返す
 */
export function sharedGameSettings<T extends SettingValues>(
  schema: SettingsSchema<T>,
  env: () => { storage: StorageLike | null; motion: MotionPreference },
): () => GameSettings<T> {
  let shared: GameSettings<T> | null = null;
  return () => (shared ??= createGameSettings(schema, env()));
}
