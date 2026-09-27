import type { HTMLAttributes, ReactNode, Ref } from 'react';

type Props = {
  /** 背景の暗さ。solid は完全に隠す、dim は暗くしてぼかす、clear はゲームをそのまま見せる */
  tone?: 'solid' | 'dim' | 'clear';
  /** 画面の上端に置く要素（もどる・設定など）。中身とは別に、常に上に並ぶ */
  top?: ReactNode;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
} & Omit<HTMLAttributes<HTMLDivElement>, 'className'>;

/**
 * 全画面を覆う画面の土台。タイトル・ステージ選択・一時停止・結果・設定などは、すべてこの上に組む。
 *
 * - 安全領域（ノッチやホームインジケーター）を避けて余白を取る
 * - 中身は幅の上限を持つ 1 列に並べ、画面に収まるときは上下中央に置く
 * - 収まらないときは縦にだけスクロールする。要素が縮んで重なったり、横にはみ出したりしない
 */
export default function Overlay({ tone = 'dim', top, children, ref, ...rest }: Props) {
  return (
    <div ref={ref} className="overlay" data-tone={tone} {...rest}>
      {top && <div className="overlay-top">{top}</div>}
      <div className="overlay-body">{children}</div>
    </div>
  );
}
