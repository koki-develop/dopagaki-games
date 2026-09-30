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

/**
 * OS の「視差効果を減らす」（`prefers-reduced-motion: reduce`）。どのゲームの設定にも属さず、ページで 1 つを共有する。
 * 問い合わせられない環境では、動きを減らさない。React からは useSyncExternalStore で読む。
 */
export class MotionPreference {
  private value: boolean;
  private readonly listeners = new Set<() => void>();

  constructor(query: MotionQuery | null = reducedMotionQuery()) {
    this.value = query?.matches ?? false;
    query?.addEventListener('change', (e) => {
      this.value = e.matches;
      for (const l of this.listeners) l();
    });
  }

  /** 動きを減らすか */
  getReduced = (): boolean => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
}

export const motionPreference = new MotionPreference();
