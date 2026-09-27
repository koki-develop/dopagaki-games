import Dialog from '../ui/Dialog.tsx';

type Props = {
  /** 確認ダイアログを出している間は、メニューを下げて確認だけを見せる */
  hidden: boolean;
  onResume: () => void;
  onAskRetry: () => void;
  onSettings: () => void;
  onAskTitle: () => void;
};

/** 一時停止メニュー。やり直しとタイトルへ戻るのは、今のプレイが記録されずに消えるので、確認を挟む */
export default function PauseView({ hidden, onResume, onAskRetry, onSettings, onAskTitle }: Props) {
  return (
    <Dialog title="PAUSE" layer="base" hidden={hidden}>
      <button type="button" className="btn" data-variant="primary" onClick={onResume} data-autofocus>
        再開
      </button>
      <button type="button" className="btn" onClick={onAskRetry}>
        やり直す
      </button>
      <button type="button" className="btn" onClick={onSettings}>
        設定
      </button>
      <button type="button" className="btn" onClick={onAskTitle}>
        タイトルへ
      </button>
    </Dialog>
  );
}
