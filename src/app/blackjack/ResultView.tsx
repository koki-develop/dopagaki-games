import { useId } from 'react';
import type { CSSProperties } from 'react';
import { formatScore, formatSigned } from '../../shared/format.ts';
import { runNet } from '../../games/blackjack/records-model.ts';
import type { RunResult } from '../../games/blackjack/types.ts';
import BestLine from '../game/BestLine.tsx';
import { resultBestOf, resultBestText } from '../game/result-best.ts';
import { useCountUp } from '../game/useCountUp.ts';
import Overlay from '../ui/Overlay.tsx';
import { RESULT_REVEAL } from './reveal.ts';
import { lifetimeSpan, sheetLines, signOf, verdictText } from './summary.ts';

type Props = {
  result: RunResult;
  /** 記録の今の累計（このプレイの結果を反映した後） */
  lifetime: number;
  onRetry: () => void;
  onTitle: () => void;
};

/**
 * 結果画面。決着と始めからの増減を出し、得点の内訳を 1 行ずつ出してから、最後の手持ち（スコア）をカウントアップする。
 * 合計の下に最高スコア（更新したらその知らせ）を出し、最後に累計をこのプレイの前の値から今の値へ数える。減らして終えた見出しは光らせない
 */
export default function ResultView({ result, lifetime, onRetry, onTitle }: Props) {
  const headingId = useId();
  const summaryId = useId();
  const lines = sheetLines(result);
  const s = result.score;
  const net = runNet(result);
  const totalAt = RESULT_REVEAL.sheetAtMs + lines.length * RESULT_REVEAL.lineStepMs;
  const total = useCountUp(s.total, totalAt, RESULT_REVEAL.totalCountMs);
  const best = resultBestOf(result.newBest, result.previousBest);
  const newBestAt = totalAt + RESULT_REVEAL.totalCountMs + RESULT_REVEAL.newBestAfterMs;
  const lifetimeAt = newBestAt + RESULT_REVEAL.popMs;
  const span = lifetimeSpan(result, lifetime);
  const shownLifetime = useCountUp(span.to, lifetimeAt, RESULT_REVEAL.lifetimeCountMs, span.from);

  const style = {
    '--result-heading-duration': `${RESULT_REVEAL.headingMs}ms`,
    '--result-net-delay': `${RESULT_REVEAL.netAtMs}ms`,
    '--result-pop-duration': `${RESULT_REVEAL.popMs}ms`,
    '--result-sheet-at': `${RESULT_REVEAL.sheetAtMs}ms`,
    '--result-line-step': `${RESULT_REVEAL.lineStepMs}ms`,
    '--result-total-at': `${totalAt}ms`,
    '--result-newbest-delay': `${newBestAt}ms`,
    '--result-lifetime-at': `${lifetimeAt}ms`,
  } as CSSProperties;

  return (
    <Overlay role="dialog" aria-labelledby={headingId} aria-describedby={summaryId} data-outcome={result.outcome} style={style}>
      <h1 id={headingId} className="result-heading bj-result-heading">
        {verdictText(result.outcome)}
      </h1>
      {/* 数はカウントアップの途中を読まないよう、確定した値をまとめて読み上げる */}
      <p id={summaryId} className="visually-hidden">
        最後の手持ち {formatScore(s.total)}。始めから {formatSigned(net)}。{result.rounds} ラウンド、ブラックジャック {result.blackjacks} 回、最大連勝 {result.maxStreak}。
        {resultBestText(best)}累計 {formatSigned(span.to)}。
      </p>

      <p className="bj-result-net" data-sign={signOf(net)}>
        {formatSigned(net)}
      </p>

      <ul className="bj-result-stats">
        <li>
          <span className="result-label">ROUNDS</span>
          <span>{result.rounds}</span>
        </li>
        <li>
          <span className="result-label">BJ</span>
          <span>{result.blackjacks}</span>
        </li>
        <li>
          <span className="result-label">STREAK</span>
          <span>{result.maxStreak}</span>
        </li>
      </ul>

      <ul className="bj-sheet">
        {lines.map((line, i) => (
          <li key={line.kind} data-kind={line.kind} style={{ '--i': i } as CSSProperties}>
            <span className="bj-sheet-label">{line.label}</span>
            <span className="bj-sheet-points">
              {line.sign}
              {formatScore(line.points)}
            </span>
          </li>
        ))}
      </ul>

      <div className="bj-result-total">
        <span className="result-label">CHIPS</span>
        <span className="bj-result-total-value" style={{ '--chars': formatScore(s.total).length } as CSSProperties}>
          {formatScore(total)}
        </span>
        <BestLine best={best} />
      </div>

      <dl className="bj-records bj-result-lifetime">
        <div className="bj-lifetime">
          <dt className="label-ja">累計</dt>
          <dd data-sign={signOf(span.to)}>{formatSigned(shownLifetime)}</dd>
        </div>
      </dl>

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
