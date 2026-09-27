import Overlay from './Overlay.tsx';

/** 読み込み中の表示。ゲームのコードの読み込み中と、描画の準備中で同じ見た目にする */
export function LoadingOverlay() {
  return (
    <Overlay tone="solid" role="status">
      <span className="loading-text">LOADING</span>
    </Overlay>
  );
}

export default function LoadingScreen() {
  return (
    <div className="screen">
      <LoadingOverlay />
    </div>
  );
}
