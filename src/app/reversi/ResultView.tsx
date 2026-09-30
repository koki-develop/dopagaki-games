import { useId } from 'react';
import type { CSSProperties } from 'react';
import { formatScore } from '../../shared/format.ts';
import type { RunResult } from '../../games/reversi/types.ts';
import { useCountUp } from '../game/useCountUp.ts';
import Overlay from '../ui/Overlay.tsx';
import { RESULT_REVEAL } from './reveal.ts';
import { leadOf, sheetLines, verdictText } from './summary.ts';

type Props = {
  result: RunResult;
  onRetry: () => void;
  onTitle: () => void;
};

/**
 * 結果画面。勝敗と石の数を出し、得点の内訳を 1 行ずつ出してから、合計をカウントアップする。最高スコアの更新も出す。
 * 負けの見出しは光らせず、負けに勝ちの点の行は出さない。記録の更新がなければ弾ける演出も出さない
 */
export default function ResultView({ result, onRetry, onTitle }: Props) {
  const headingId = useId();
  const summaryId = useId();
  const lines = sheetLines(result);
  const totalAt = RESULT_REVEAL.sheetAtMs + lines.length * RESULT_REVEAL.lineStepMs;
  const human = useCountUp(result.human, RESULT_REVEAL.settleMs, RESULT_REVEAL.countUpMs);
  const cpu = useCountUp(result.cpu, RESULT_REVEAL.settleMs, RESULT_REVEAL.countUpMs);
  const total = useCountUp(result.score.total, totalAt, RESULT_REVEAL.totalCountMs);

  const style = {
    '--result-heading-duration': `${RESULT_REVEAL.headingMs}ms`,
    '--result-discs-delay': `${RESULT_REVEAL.discsPopAtMs}ms`,
    '--result-pop-duration': `${RESULT_REVEAL.popMs}ms`,
    '--result-sheet-at': `${RESULT_REVEAL.sheetAtMs}ms`,
    '--result-line-step': `${RESULT_REVEAL.lineStepMs}ms`,
    '--result-total-at': `${totalAt}ms`,
    '--result-newbest-delay': `${totalAt + RESULT_REVEAL.totalCountMs + RESULT_REVEAL.newBestAfterMs}ms`,
  } as CSSProperties;

  return (
    <Overlay
      role="dialog"
      aria-labelledby={headingId}
      aria-describedby={summaryId}
      data-outcome={result.outcome}
      data-perfect={result.perfect}
      style={style}
    >
      <h1 id={headingId} className="result-heading rv-result-heading">
        {verdictText(result.outcome, result.perfect)}
      </h1>
      {/* 数はカウントアップの途中を読まないよう、確定した値をまとめて読み上げる */}
      <p id={summaryId} className="visually-hidden">
        石 {result.human} 対 {result.cpu}。スコア {formatScore(result.score.total)}。{result.newBest && '最高スコアを更新しました。'}
      </p>

      <div className="rv-result-discs">
        <span className="result-label">YOU</span>
        <span className="rv-result-count" data-side="human" data-lead={leadOf(result.human, result.cpu)}>
          {human}
        </span>
        <span className="rv-result-dash">–</span>
        <span className="rv-result-count" data-side="cpu" data-lead={leadOf(result.cpu, result.human)}>
          {cpu}
        </span>
        <span className="result-label">CPU</span>
      </div>

      <ul className="rv-sheet">
        {lines.map((line, i) => (
          <li key={line.kind} data-kind={line.kind} style={{ '--i': i } as CSSProperties}>
            <span className="rv-sheet-label">{line.label}</span>
            <span className="rv-sheet-points">+{formatScore(line.points)}</span>
          </li>
        ))}
      </ul>

      <div className="rv-result-total">
        <span className="result-label">SCORE</span>
        <span className="rv-result-total-value">{formatScore(total)}</span>
        {result.newBest && <span className="result-newbest">NEW BEST!</span>}
      </div>

      <div className="action-list">
        <button type="button" className="btn" data-variant="primary" onClick={onRetry} autoFocus>
          もう一度
        </button>
        <button type="button" className="btn" onClick={onTitle}>
          タイトルへ
        </button>
      </div>
    </Overlay>
  );
}
