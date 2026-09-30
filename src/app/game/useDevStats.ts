import { useEffect, useState } from 'react';

/** 開発用パネルに出す、フレームの速さ。fps は平均、frameMs は区間の中でいちばん長かったフレームの時間 */
type FrameStats = { fps: number; frameMs: number };

/** 集計する区間の長さ（ms） */
const WINDOW_MS = 500;

/**
 * 開発用パネルの表示。WINDOW_MS ごとに、フレームの速さと、source.debugInfo（ゲームの開発用の操作口が返す状態）をまとめて返す。
 * source は同じオブジェクトを渡し続ける。null の間は測らない
 */
export function useFrameStats<T extends object>(source: { readonly debugInfo: T } | null): (T & FrameStats) | null {
  const [stats, setStats] = useState<(T & FrameStats) | null>(null);

  useEffect(() => {
    if (!source) return;
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    let worst = 0;
    let prev = last;
    const tick = (now: number) => {
      frames++;
      worst = Math.max(worst, now - prev);
      prev = now;
      if (now - last >= WINDOW_MS) {
        setStats({ ...source.debugInfo, fps: (frames * 1000) / (now - last), frameMs: worst });
        frames = 0;
        worst = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [source]);

  return stats;
}

/** 開発用の自動操作の切り替え。hooks はゲームの開発用の操作口 */
export function useDebugAutoplay(hooks: { readonly debugAutoplay: boolean; setDebugAutoplay(on: boolean): void } | null): [boolean, () => void] {
  const [on, setOn] = useState(() => hooks?.debugAutoplay ?? false);
  const toggle = () => {
    if (!hooks) return;
    const next = !hooks.debugAutoplay;
    hooks.setDebugAutoplay(next);
    setOn(next);
  };
  return [on, toggle];
}
