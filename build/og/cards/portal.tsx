import { SITE_NAME } from '../../../src/app/site.ts';
import type { OgCard } from '../card.ts';
import { Frame, Wordmark } from './common.tsx';

export const portalCard: OgCard = {
  alt: `${SITE_NAME} のロゴ`,
  render: () => (
    <Frame>
      <Wordmark size={150} />
    </Frame>
  ),
};
