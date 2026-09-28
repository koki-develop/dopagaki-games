import type { ReactNode } from 'react';

/** OG 画像の大きさ。Facebook・X・LINE などのリンクのプレビューで大きく出る 1.91:1 */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** 1 枚の OG 画像の描き方 */
export type OgCard = {
  /** 画像の代替テキスト（og:image:alt） */
  readonly alt: string;
  /** OG_WIDTH × OG_HEIGHT の画面全体。satori に渡す要素 */
  readonly render: () => ReactNode;
};
