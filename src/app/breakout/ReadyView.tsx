import type { RunMode } from '../../games/breakout/types.ts';
import { STAGES } from '../../games/breakout/stages/stages.ts';
import Overlay from '../ui/Overlay.tsx';

type Props = {
  mode: RunMode;
  onStart: () => void;
};

/**
 * 「タップしてスタート」。画面のどこを離してもプレイを始める。
 * 音の解錠は pointerup の中で行う必要がある（タッチの pointerdown はユーザー操作として扱われない）。
 * キーボードでは、フォーカスしたボタンの Enter / Space（ボタン本来の押下）で始める。
 * 同じ操作で pointerup と click の両方が届いても、始めるのは 1 回だけ（状態機械が 2 回目を無視する）。
 */
export default function ReadyView({ mode, onStart }: Props) {
  const stage = mode.kind === 'stage' ? STAGES[mode.index] : undefined;
  return (
    <Overlay tone="clear" onPointerUp={onStart}>
      <span className="ready-title">{mode.kind === 'endless' ? 'ENDLESS' : `STAGE ${mode.index + 1}`}</span>
      {stage && <span className="ready-sub">{stage.name}</span>}
      <button type="button" className="ready-cta" autoFocus onClick={onStart}>
        タップしてスタート
      </button>
    </Overlay>
  );
}
