import { selectableStages } from '../../games/breakout/records-model.ts';
import type { Records } from '../../games/breakout/records-model.ts';
import { STAGES, isMilestoneStage } from '../../games/breakout/stages/stages.ts';
import Overlay from '../ui/Overlay.tsx';

type Props = {
  records: Records;
  onChoose: (index: number) => void;
  onBack: () => void;
};

/**
 * ステージ選択。番号のタイルを 5 列の格子に並べるので、節目の面（5 の倍数）は右端の列にそろう。
 * クリア済みのステージと、その次のステージを選べる。開いたときは次に遊ぶステージにフォーカスを当て、そこまでスクロールする。
 */
export default function StageSelectView({ records, onChoose, onBack }: Props) {
  const open = selectableStages(records, STAGES.length);
  return (
    <Overlay
      top={
        <button type="button" className="back" onClick={onBack}>
          ← もどる
        </button>
      }
    >
      <h2 className="screen-title">STAGE</h2>
      <ol className="stage-grid">
        {STAGES.map((s, i) => {
          const no = i + 1;
          const locked = i >= open;
          const cleared = i < records.stagesCleared;
          const state = locked ? 'locked' : cleared ? 'cleared' : 'next';
          return (
            <li key={s.id}>
              <button
                type="button"
                className="stage-tile"
                disabled={locked}
                data-state={state}
                data-milestone={isMilestoneStage(i)}
                autoFocus={i === open - 1}
                onClick={() => onChoose(i)}
                aria-label={locked ? `ステージ ${no}（未解放）` : `ステージ ${no} ${s.name}${cleared ? '（クリア済み）' : ''}`}
              >
                {no}
              </button>
            </li>
          );
        })}
      </ol>
    </Overlay>
  );
}
