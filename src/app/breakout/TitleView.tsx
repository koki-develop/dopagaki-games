import type { Records } from '../../games/breakout/records.ts';
import { formatScore } from '../../games/breakout/hud/format.ts';
import { STAGES } from '../../games/breakout/stages/stages.ts';
import Overlay from '../ui/Overlay.tsx';

type Props = {
  records: Records;
  onEndless: () => void;
  onStages: () => void;
  onSettings: () => void;
  portalHref: string;
};

/** タイトル。エンドレスとステージの 2 択 */
export default function TitleView({ records, onEndless, onStages, onSettings, portalHref }: Props) {
  return (
    <Overlay
      top={
        <>
          <a className="back" href={portalHref}>
            ← もどる
          </a>
          <button type="button" className="icon-btn" aria-label="設定" onClick={onSettings}>
            <span className="gear-icon" />
          </button>
        </>
      }
    >
      <h1 className="title-logo">
        <span>ブロック</span>
        <span>崩し</span>
      </h1>

      <div className="choice-list">
        <button type="button" className="choice" onClick={onEndless}>
          <span className="choice-name">ENDLESS</span>
          <span className="choice-desc">
            終わりのない<wbr />モードです。
          </span>
          <span className="choice-meta">BEST {formatScore(records.bestEndless)}</span>
        </button>
        <button type="button" className="choice" data-accent="magenta" onClick={onStages}>
          <span className="choice-name">STAGE</span>
          <span className="choice-desc">
            ステージを<wbr />ひとつずつ<wbr />クリアしていく<wbr />モードです。
          </span>
          <span className="choice-meta">
            CLEAR {records.stagesCleared} / {STAGES.length}
          </span>
        </button>
      </div>
    </Overlay>
  );
}
