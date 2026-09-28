import type { OgCard } from '../card.ts';
import { DISPLAY_FONT } from '../fonts.ts';
import { Frame, Wordmark } from './common.tsx';

// ゲームのタイトル画面のロゴ（src/app/styles.css の .title-logo）と同じ光り方
const CYAN_GLOW = '0 0 6px rgba(255,255,255,0.7), 0 0 16px rgb(94,242,255), 0 0 38px rgba(94,242,255,0.4)';
const MAGENTA_GLOW = '0 0 6px rgba(255,255,255,0.7), 0 0 16px rgb(255,92,225), 0 0 38px rgba(255,92,225,0.45)';

export const breakoutCard: OgCard = {
  alt: 'DOPAGAKI GAMES のブロック崩し',
  render: () => (
    <Frame>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          fontFamily: DISPLAY_FONT,
          lineHeight: 1,
          color: '#ffffff',
          fontSize: 132,
        }}
      >
        <span style={{ textShadow: CYAN_GLOW }}>ブロック</span>
        <span style={{ fontSize: 158, textShadow: MAGENTA_GLOW }}>崩し</span>
      </div>
      <div style={{ display: 'flex', position: 'absolute', top: 56, left: 64 }}>
        <Wordmark size={40} />
      </div>
    </Frame>
  ),
};
