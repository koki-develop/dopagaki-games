import { useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import Overlay from './Overlay.tsx';

type Props = {
  /** 見出し。ダイアログの名前として読み上げる */
  title: string;
  /** 見出しの下の説明 */
  message?: string;
  /** alertdialog は取り消せない操作の確認 */
  role?: 'dialog' | 'alertdialog';
  /** modal は画面全体の最前面に重ねる。base はほかの画面と同じ高さに置く */
  layer?: 'modal' | 'base';
  hidden?: boolean;
  children: ReactNode;
};

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 画面の上に重ねる操作パネル。
 *
 * - 開いた瞬間に、中の `data-autofocus` の要素（なければ最初の操作できる要素）へフォーカスを移す
 * - 開いている間は、同じ親の中にあるほかの要素を inert にし、背後を操作・読み上げできないようにする
 * - 閉じたら、開く前にフォーカスがあった要素へ戻す
 *
 * Escape で閉じる操作は、画面の状態機械が受け持つ。
 */
export default function Dialog({ title, message, role = 'dialog', layer = 'modal', hidden, children }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // 背後を inert にする前に、戻り先を覚えておく（inert になった要素からはフォーカスが外れるため）
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inerted: HTMLElement[] = [];
    for (const el of Array.from(root.parentElement?.children ?? [])) {
      if (el === root || !(el instanceof HTMLElement) || el.inert) continue;
      el.inert = true;
      inerted.push(el);
    }
    const initial = root.querySelector<HTMLElement>('[data-autofocus]') ?? root.querySelector<HTMLElement>(FOCUSABLE);
    initial?.focus({ preventScroll: true });
    return () => {
      for (const el of inerted) el.inert = false;
      // 閉じると同時に書き換わる周りの DOM（隠していたメニューの再表示など）が反映されてから戻す
      queueMicrotask(() => {
        if (opener?.isConnected && !opener.inert) opener.focus({ preventScroll: true });
      });
    };
  }, []);

  return (
    <Overlay
      ref={rootRef}
      role={role}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={message ? messageId : undefined}
      data-layer={layer === 'modal' ? 'modal' : undefined}
      hidden={hidden}
    >
      <div className="panel">
        <h2 id={titleId} className="panel-title">
          {title}
        </h2>
        {message && (
          <p id={messageId} className="panel-message">
            {message}
          </p>
        )}
        {children}
      </div>
    </Overlay>
  );
}
