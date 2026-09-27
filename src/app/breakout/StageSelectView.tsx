import { selectableStages } from '../../games/breakout/records.ts';
import type { Records } from '../../games/breakout/records.ts';
import { formatScore } from '../../games/breakout/hud/format.ts';
import { STAGES } from '../../games/breakout/stages/stages.ts';
import Overlay from '../ui/Overlay.tsx';

type Props = {
  records: Records;
  onChoose: (index: number) => void;
  onBack: () => void;
};

/** ステージ選択。ステージを縦一列に並べる。クリア済みのステージと、その次のステージを選べる */
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
      <ol className="stage-list">
        {STAGES.map((s, i) => {
          const locked = i >= open;
          const cleared = i < records.stagesCleared;
          return (
            <li key={s.id}>
              <button
                type="button"
                className="stage-row"
                disabled={locked}
                data-cleared={cleared}
                onClick={() => onChoose(i)}
                aria-label={locked ? `ステージ ${i + 1}（未解放）` : `ステージ ${i + 1} ${s.name}`}
              >
                <span className="stage-row-no">{i + 1}</span>
                <span className="stage-row-name">{locked ? 'LOCKED' : s.name}</span>
                <span className="stage-row-meta">{locked ? '' : cleared ? `BEST ${formatScore(records.bestStage[s.id] ?? 0)}` : 'NEW'}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </Overlay>
  );
}
