import Link from './ui/Link.tsx';
import Overlay from './ui/Overlay.tsx';

/** どのページにも当たらないパスの画面。配信側はこの画面をステータス 404 で返す */
export default function NotFound() {
  return (
    <div className="screen">
      <Overlay tone="solid">
        <main className="panel not-found">
          <h1 className="panel-title">
            ページが<wbr />見つかりません
          </h1>
          <p className="panel-message">
            URL を<wbr />もう一度<wbr />確かめてください。
          </p>
          <div className="panel-actions">
            <Link className="btn" data-variant="primary" to="portal">
              ゲーム一覧へ
            </Link>
          </div>
        </main>
      </Overlay>
    </div>
  );
}
