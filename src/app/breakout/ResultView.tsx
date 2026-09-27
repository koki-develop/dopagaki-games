import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { RESULT_REVEAL } from '../../games/breakout/controller.ts';
import type { RunResult } from '../../games/breakout/types.ts';
import { formatScore } from '../../games/breakout/hud/format.ts';
import { STAGES } from '../../games/breakout/stages/stages.ts';
import { clamp01 } from '../../shared/math.ts';
import Overlay from '../ui/Overlay.tsx';
import { useReducedMotion } from '../useSettings.ts';

type Props = {
  result: RunResult;
  onRetry: () => void;
  onNext: (() => void) | null;
  onTitle: () => void;
};

/** 演出の時刻を、CSS のアニメーション（styles.css の結果画面）へ渡すカスタムプロパティ */
const REVEAL_STYLE = {
  '--result-heading-duration': `${RESULT_REVEAL.headingMs}ms`,
  '--result-score-delay': `${RESULT_REVEAL.scorePopAtMs}ms`,
  '--result-pop-duration': `${RESULT_REVEAL.popMs}ms`,
  '--result-newbest-delay': `${RESULT_REVEAL.newBestAtMs}ms`,
} as CSSProperties;

/** 数字を 0 から目標までカウントアップする。動きを減らす設定のときは、最初から目標を出す */
function useCountUp(target: number, delayMs: number, durationMs: number, reduced: boolean): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const start = performance.now() + (reduced ? 0 : delayMs);
    let raf = 0;
    const tick = (now: number) => {
      const t = reduced ? 1 : clamp01((now - start) / durationMs);
      // 最後にゆっくり止まる
      const e = 1 - (1 - t) ** 4;
      setV(Math.round(target * e));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, delayMs, durationMs, reduced]);
  return v;
}

export default function ResultView({ result, onRetry, onNext, onTitle }: Props) {
  const { mode } = result;
  const cleared = mode.kind === 'stage' && result.cleared;
  const shownTotal = useCountUp(result.score, RESULT_REVEAL.settleMs, RESULT_REVEAL.countUpMs, useReducedMotion());
  const stage = mode.kind === 'stage' ? STAGES[mode.index] : undefined;

  return (
    <Overlay data-cleared={cleared} style={REVEAL_STYLE}>
      <h1 className="result-heading">{cleared ? 'STAGE CLEAR' : 'GAME OVER'}</h1>
      {mode.kind === 'stage' && (
        <p className="result-stage">
          STAGE {mode.index + 1}
          {stage && ` — ${stage.name}`}
        </p>
      )}

      <div className="result-score">
        <span className="result-label">SCORE</span>
        <span className="result-total">{formatScore(shownTotal)}</span>
        {result.newBest ? (
          <span className="result-newbest">NEW BEST!</span>
        ) : (
          <span className="result-best">BEST {formatScore(result.previousBest)}</span>
        )}
      </div>

      <div className="action-list">
        {onNext && (
          <button type="button" className="btn" data-variant="primary" onClick={onNext}>
            次のステージ
          </button>
        )}
        <button type="button" className="btn" data-variant={onNext ? undefined : 'primary'} onClick={onRetry} autoFocus>
          もう一度
        </button>
        <button type="button" className="btn" onClick={onTitle}>
          タイトルへ
        </button>
      </div>
    </Overlay>
  );
}
