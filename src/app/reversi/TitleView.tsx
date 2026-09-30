import { useId } from 'react';
import { formatScore } from '../../shared/format.ts';
import type { Records } from '../../games/reversi/records-model.ts';
import { BLACK, WHITE } from '../../games/reversi/rules/position.ts';
import type { Color } from '../../games/reversi/rules/position.ts';
import type { MatchSetup } from '../../games/reversi/types.ts';
import Link from '../ui/Link.tsx';
import Overlay from '../ui/Overlay.tsx';
import { recordText } from './summary.ts';

type Props = {
  records: Records;
  /** 選んでいる色 */
  setup: MatchSetup;
  onChooseSide: (human: Color) => void;
  onStart: () => void;
  onSettings: () => void;
};

const SIDES: readonly { color: Color; label: string; sub: string }[] = [
  { color: BLACK, label: '黒', sub: '先手' },
  { color: WHITE, label: '白', sub: '後手' },
];

/**
 * タイトル。持つ色（黒は先手）を選び、スタートでその場で対局を始める。
 * 選んだ色は覚えておき、次に開いたときの初期値にする。最高スコア・最大コンボ・勝敗を見せる
 */
export default function TitleView({ records, setup, onChooseSide, onStart, onSettings }: Props) {
  const name = useId();

  return (
    <Overlay
      top={
        <>
          <Link className="back" to="portal">
            ← もどる
          </Link>
          <button type="button" className="icon-btn" aria-label="設定" onClick={onSettings}>
            <span className="gear-icon" />
          </button>
        </>
      }
    >
      <h1 className="title-logo rv-title-logo">
        <span>リバーシ</span>
      </h1>

      <fieldset className="setting rv-side">
        <legend className="setting-label">持つ石</legend>
        <div className="segmented">
          {SIDES.map((s) => (
            <label key={s.color}>
              <input type="radio" name={name} checked={setup.human === s.color} onChange={() => onChooseSide(s.color)} />
              <span>
                <span className={`rv-disc rv-disc-${s.color === BLACK ? 'black' : 'white'}`} aria-hidden="true" />
                {s.label}（{s.sub}）
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <button type="button" className="btn rv-start" data-variant="primary" onClick={onStart}>
        スタート
      </button>

      <dl className="rv-records">
        <div>
          <dt>BEST SCORE</dt>
          <dd>{formatScore(records.bestScore)}</dd>
        </div>
        <div>
          <dt>MAX COMBO</dt>
          <dd>{records.maxCombo}</dd>
        </div>
        <div>
          <dt>対局</dt>
          <dd>{recordText(records)}</dd>
        </div>
      </dl>
    </Overlay>
  );
}
