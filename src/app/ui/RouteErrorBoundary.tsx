import { Component } from 'react';
import type { ReactNode } from 'react';
import Link from './Link.tsx';
import Overlay from './Overlay.tsx';

type Props = { children: ReactNode };
type State = { failed: boolean };

/** 画面の読み込みや表示に失敗したときに、真っ白にせず、読み込み直すかポータルへ戻れるようにする */
export default class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen">
        <Overlay tone="solid">
          <div className="panel" role="alert">
            <h2 className="panel-title">読み込めませんでした</h2>
            <p>通信の状態を確かめて、読み込み直してください。</p>
            <div className="panel-actions">
              <button type="button" className="btn" data-variant="primary" onClick={() => window.location.reload()}>
                読み込み直す
              </button>
              <Link className="btn" to="portal">
                もどる
              </Link>
            </div>
          </div>
        </Overlay>
      </div>
    );
  }
}
