import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { hrefOf, isPlainClick, navigate } from '../router.ts';
import type { PageId } from '../site.ts';

type Props = {
  to: PageId;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'download'>;

/**
 * サイト内のページへのリンク。href を持つ普通の a 要素として描くので、クローラーがたどれ、新しいタブでも開ける。
 * 普通のクリックだけを横取りし、ページを読み込み直さずに画面を切り替える
 */
export default function Link({ to, onClick, ...rest }: Props) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (!isPlainClick(e)) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={hrefOf(to)} onClick={handleClick} {...rest} />;
}
