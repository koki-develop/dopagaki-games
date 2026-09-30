import { useId } from 'react';
import type { CSSProperties } from 'react';
import type { RunResult } from '../../games/breakout/types.ts';
import { formatScore } from '../../shared/format.ts';
import { STAGES } from '../../games/breakout/stages/stages.ts';
import { useCountUp } from '../game/useCountUp.ts';
import Overlay from '../ui/Overlay.tsx';
import { RESULT_REVEAL } from './reveal.ts';

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

export default function ResultView({ result, onRetry, onNext, onTitle }: Props) {
  const { mode } = result;
  const cleared = mode.kind === 'stage' && result.cleared;
  const headingId = useId();
  const summaryId = useId();
  const shownTotal = useCountUp(result.score, RESULT_REVEAL.settleMs, RESULT_REVEAL.countUpMs);
  const stage = mode.kind === 'stage' ? STAGES[mode.index] : undefined;

  return (
    <Overlay role="dialog" aria-labelledby={headingId} aria-describedby={summaryId} data-cleared={cleared} style={REVEAL_STYLE}>
      <h1 id={headingId} className="result-heading">
        {cleared ? 'STAGE CLEAR' : 'GAME OVER'}
      </h1>
      {mode.kind === 'stage' && (
        <p className="result-stage">
          STAGE {mode.index + 1}
          {stage && ` — ${stage.name}`}
        </p>
      )}
      {/* スコアはカウントアップの途中を読まないよう、確定した値をまとめて読み上げる */}
      <p id={summaryId} className="visually-hidden">
        {mode.kind === 'stage' && `STAGE ${mode.index + 1}。`}
        スコア {formatScore(result.score)}。{result.newBest ? '最高スコアを更新しました。' : `ベスト ${formatScore(result.previousBest)}。`}
      </p>

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
