import { useEffect, useState } from 'react';
import { clamp01 } from '../../shared/math.ts';
import { useReducedMotion } from '../useReducedMotion.ts';

/** 数え始めてから elapsedMs 経ったときに見せる数。durationMs かけて target に届き、最後はゆっくり止まる */
export function countUpValue(target: number, elapsedMs: number, durationMs: number): number {
  const t = durationMs > 0 ? clamp01(elapsedMs / durationMs) : 1;
  return Math.round(target * (1 - (1 - t) ** 4));
}

/**
 * 数字を 0 から目標まで、delayMs 待ってから durationMs かけてカウントアップし、最後にゆっくり止める。
 * 動きを減らす設定のときは、最初から目標を出す
 */
export function useCountUp(target: number, delayMs: number, durationMs: number): number {
  const reduced = useReducedMotion();
  const [v, setV] = useState(() => (reduced ? target : 0));
  useEffect(() => {
    const start = performance.now() + (reduced ? 0 : delayMs);
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = reduced ? durationMs : now - start;
      setV(countUpValue(target, elapsed, durationMs));
      if (elapsed < durationMs) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, delayMs, durationMs, reduced]);
  return v;
}
