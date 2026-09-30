import type { CSSProperties } from 'react';
import type { OgCard } from '../card.ts';
import { DISPLAY_FONT } from '../fonts.ts';
import { Frame, Wordmark } from './common.tsx';

// ゲームのタイトル画面のロゴと石の色（src/app/styles.css の .rv-title-logo と .rv-disc）に合わせる
const MINT_GLOW = '0 0 6px rgba(255,255,255,0.7), 0 0 18px rgb(92,255,205), 0 0 42px rgba(92,255,205,0.45)';

const disc = (face: string, rim: string): CSSProperties => ({
  width: 150,
  height: 150,
  borderRadius: 75,
  background: face,
  border: `8px solid ${rim}`,
  boxShadow: `0 0 28px ${rim}`,
});

export const reversiCard: OgCard = {
  alt: 'DOPAGAKI GAMES のリバーシ',
  render: () => (
    <Frame>
      <div style={{ display: 'flex', alignItems: 'center', gap: 44 }}>
        <div style={disc('rgb(14,10,22)', 'rgb(214,92,255)')} />
        <div style={{ display: 'flex', fontFamily: DISPLAY_FONT, fontSize: 150, lineHeight: 1, color: '#ffffff', textShadow: MINT_GLOW }}>リバーシ</div>
        <div style={disc('rgb(236,240,250)', 'rgb(94,242,255)')} />
      </div>
      <div style={{ display: 'flex', position: 'absolute', top: 56, left: 64 }}>
        <Wordmark size={40} />
      </div>
    </Frame>
  ),
};
