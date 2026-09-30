import type { FatalCause } from '../../shared/fatal.ts';
import Link from '../ui/Link.tsx';
import Overlay from '../ui/Overlay.tsx';

/** エラー画面の説明。原因ごとに、何ができなかったかを書く */
const FATAL_TEXT: Record<FatalCause, string> = {
  init: 'このブラウザでは、ゲームの描画（WebGPU / WebGL2）を始められませんでした。',
  lost: 'GPU との接続が切れ、ゲームの描画を作り直せませんでした。',
  internal: 'ゲームの処理で問題が起きたため、続けられませんでした。',
};

type Props = { cause: FatalCause; message: string };

/** ゲームを続けられなくなったときの画面。ポータルへ戻れる */
export default function FatalView({ cause, message }: Props) {
  return (
    <Overlay tone="solid">
      <div className="panel" role="alert">
        <h2 className="panel-title">表示できませんでした</h2>
        <p>{FATAL_TEXT[cause]}</p>
        <p className="muted small">{message}</p>
        <div className="panel-actions">
          <Link className="btn" to="portal">
            もどる
          </Link>
        </div>
      </div>
    </Overlay>
  );
}
