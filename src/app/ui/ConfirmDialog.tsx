import Dialog from './Dialog.tsx';

type Props = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** 取り消せない操作の前に出す確認。いま開いている画面の上に重ねる。押し間違いに備えて、最初はキャンセルを選んでおく */
export default function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  return (
    <Dialog role="alertdialog" title={title} message={message}>
      <div className="panel-actions">
        <button type="button" className="btn" data-variant="primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel} data-autofocus>
          キャンセル
        </button>
      </div>
    </Dialog>
  );
}
