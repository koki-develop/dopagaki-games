import { formatScore, formatSigned } from '../../shared/format.ts';
import { lifetimeNet } from '../../games/blackjack/records-model.ts';
import type { Records } from '../../games/blackjack/records-model.ts';
import Link from '../ui/Link.tsx';
import Overlay from '../ui/Overlay.tsx';
import { signOf } from './summary.ts';

type Props = {
  records: Records;
  onStart: () => void;
  onSettings: () => void;
};

/**
 * タイトル。スタートでその場でプレイを始める。最高スコアと、これまでのプレイの増減の累計を見せる
 */
export default function TitleView({ records, onStart, onSettings }: Props) {
  const lifetime = lifetimeNet(records);
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
      <h1 className="title-logo bj-title-logo">
        <span>ブラック</span>
        <span>ジャック</span>
      </h1>

      <button type="button" className="btn bj-start" data-variant="primary" onClick={onStart}>
        スタート
      </button>

      <dl className="bj-records">
        <div className="bj-best">
          <dt>BEST CHIPS</dt>
          <dd>{formatScore(records.bestScore)}</dd>
        </div>
        <div className="bj-lifetime">
          <dt className="label-ja">累計</dt>
          <dd data-sign={signOf(lifetime)}>{formatSigned(lifetime)}</dd>
        </div>
      </dl>
    </Overlay>
  );
}
