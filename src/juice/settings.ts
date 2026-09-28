import type { CameraMotion } from './camera.ts';
import { safeLocalStorage } from './storage.ts';
import type { StorageLike } from './storage.ts';

export type Settings = {
  /** 画面の揺れ。衝撃による揺れと、それに伴う引き、ビートに合わせた拍動 */
  shake: boolean;
  /** 効果音 */
  sfx: boolean;
  /** BGM */
  bgm: boolean;
};

const STORAGE_KEY = 'dopagaki:settings';

/** 音量は控えめに固定する。細かい調整は端末の音量で行う */
export const VOLUME_MASTER = 0.45;
export const VOLUME_SFX = 0.9;
export const VOLUME_BGM = 0.7;

/** `prefers-reduced-motion: reduce` のときの、カメラの引きとビートの拍動の倍率 */
const REDUCED_CAMERA_MOTION = 0.3;

/**
 * ユーザー設定から、カメラの動きの種類ごとの倍率を決める。
 * 画面の揺れをオフにすると、衝撃による揺れと、それに伴う引き、ビートの拍動を止める。大きな節目の引きは止めない。
 * `prefers-reduced-motion: reduce` では、拍動と引きを弱める。
 */
export function cameraMotionFor(s: Settings, reducedMotion: boolean, out: CameraMotion): CameraMotion {
  const motion = reducedMotion ? REDUCED_CAMERA_MOTION : 1;
  out.shake = s.shake ? 1 : 0;
  out.pulse = s.shake ? motion : 0;
  out.pull = motion;
  out.punch = s.shake ? motion : 0;
  return out;
}

/** `prefers-reduced-motion` の問い合わせ結果として使う MediaQueryList の一部 */
export type MotionQuery = {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (e: { readonly matches: boolean }) => void): void;
};

function reducedMotionQuery(): MotionQuery | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
}

export function defaultSettings(reducedMotion: boolean): Settings {
  return { shake: !reducedMotion, sfx: true, bgm: true };
}

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** 保存された値を検証して取り込む。壊れた値や未知の値は既定値に置き換える */
export function sanitizeSettings(raw: unknown, defaults: Settings): Settings {
  if (typeof raw !== 'object' || raw === null) return defaults;
  const r = raw as Record<string, unknown>;
  return { shake: bool(r.shake, defaults.shake), sfx: bool(r.sfx, defaults.sfx), bgm: bool(r.bgm, defaults.bgm) };
}

type Listener = () => void;

/**
 * ユーザー設定の保存先。React からは useSyncExternalStore で、ゲームからは get() で読む。
 * `prefers-reduced-motion` の変化も監視する。
 */
export class SettingsStore {
  private value: Settings;
  private reduced: boolean;
  /** 毎フレーム読まれるので、作り直さずに設定が変わったときだけ書き換える */
  private readonly motion: CameraMotion = { shake: 1, pulse: 1, pull: 1, punch: 1 };
  private readonly listeners = new Set<Listener>();
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null = safeLocalStorage(), motion: MotionQuery | null = reducedMotionQuery()) {
    this.storage = storage;
    this.reduced = motion?.matches ?? false;
    motion?.addEventListener('change', (e) => {
      this.reduced = e.matches;
      cameraMotionFor(this.value, this.reduced, this.motion);
      this.emit();
    });
    this.value = this.load();
    cameraMotionFor(this.value, this.reduced, this.motion);
  }

  get = (): Settings => this.value;

  /** `prefers-reduced-motion: reduce` か。変化は subscribe で知らせる */
  get reducedMotion(): boolean {
    return this.reduced;
  }

  /** カメラの動きの種類ごとの倍率。設定が変わると同じオブジェクトの中身が変わる */
  get cameraMotion(): Readonly<CameraMotion> {
    return this.motion;
  }

  update(patch: Partial<Settings>): void {
    this.value = sanitizeSettings({ ...this.value, ...patch }, this.value);
    cameraMotionFor(this.value, this.reduced, this.motion);
    this.save();
    this.emit();
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private load(): Settings {
    const defaults = defaultSettings(this.reduced);
    if (!this.storage) return defaults;
    try {
      const text = this.storage.getItem(STORAGE_KEY);
      return text ? sanitizeSettings(JSON.parse(text), defaults) : defaults;
    } catch {
      return defaults;
    }
  }

  private save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.value));
    } catch {
      // プライベートブラウズや容量超過で保存できなくても、その回のプレイは続ける
    }
  }
}

export const settings = new SettingsStore();
