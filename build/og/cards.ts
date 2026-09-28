import type { PageId } from '../../src/app/site.ts';
import type { OgCard } from './card.ts';
import { breakoutCard } from './cards/breakout.tsx';
import { portalCard } from './cards/portal.tsx';

/** ページごとの OG 画像。ページを足したら、ここに画像を足さないと型エラーになる */
export const OG_CARDS: Readonly<Record<PageId, OgCard>> = {
  portal: portalCard,
  breakout: breakoutCard,
};
