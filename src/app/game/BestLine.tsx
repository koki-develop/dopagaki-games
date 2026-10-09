import { formatScore } from '../../shared/format.ts';
import type { ResultBest } from './result-best.ts';

/** 結果画面のスコアの下に出す最高スコアの欄。NEW BEST! は styles.css の --result-newbest-delay の時刻に弾けて出る */
export default function BestLine({ best }: { best: ResultBest }) {
  switch (best.k) {
    case 'new':
      return <span className="result-newbest">NEW BEST!</span>;
    case 'previous':
      return <span className="result-best">BEST {formatScore(best.score)}</span>;
    case 'none':
      return null;
  }
}
