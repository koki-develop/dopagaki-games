import { useState } from 'react';

/**
 * ページ内で画面を切り替えたときに、新しい画面の題名をスクリーンリーダーへ読み上げさせる。
 * ページを読み込み直す遷移ならブラウザが題名を読み上げるが、pushState による切り替えでは何も伝わらないため。
 * 読み込んだ直後の題名はブラウザが読むので、ここでは切り替わったときだけ読み上げる
 */
export default function RouteAnnouncer({ title }: { title: string }) {
  const [shownTitle, setShownTitle] = useState(title);
  const [announcement, setAnnouncement] = useState('');
  if (title !== shownTitle) {
    setShownTitle(title);
    setAnnouncement(title);
  }
  return (
    <p className="visually-hidden" aria-live="assertive" aria-atomic="true">
      {announcement}
    </p>
  );
}
