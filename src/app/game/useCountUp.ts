import { useEffect, useState } from 'react';
import { clamp01 } from '../../shared/math.ts';
import { useReducedMotion } from '../useReducedMotion.ts';

/** 数え始めてから elapsedMs 経ったときに見せる数。from から始まり、durationMs かけて target に届き、最後はゆっくり止まる */
export function countUpValue(target: number, elapsedMs: number, durationMs: number, from = 0): number {
  const t = durationMs > 0 ? clamp01(elapsedMs / durationMs) : 1;
  return Math.round(from + (target - from) * (1 - (1 - t) ** 4));
}

/**
 * 数字を from（省略すると 0）から目標まで、delayMs 待ってから durationMs かけて数え、最後にゆっくり止める。
 * 動きを減らす設定のときは、最初から目標を出す
 */
export function useCountUp(target: number, delayMs: number, durationMs: number, from = 0): number {
  const reduced = useReducedMotion();
  const [v, setV] = useState(() => (reduced ? target : from));
  useEffect(() => {
    const start = performance.now() + (reduced ? 0 : delayMs);
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = reduced ? durationMs : now - start;
      setV(countUpValue(target, elapsed, durationMs, from));
      if (elapsed < durationMs) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, delayMs, durationMs, from, reduced]);
  return v;
}
