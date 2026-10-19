import type { OgCard } from '../card.ts';
import { DISPLAY_FONT } from '../fonts.ts';
import { Frame, Wordmark } from './common.tsx';
import { PlayingCard } from './playing-card.tsx';

// ゲームのタイトル画面のロゴ（src/app/styles.css の .bj-title-logo）に合わせる
const GOLD_GLOW = '0 0 6px rgba(255,255,255,0.7), 0 0 18px rgb(255,207,92), 0 0 42px rgba(255,207,92,0.45)';
const RED = '#c8102e';
const BLACK = '#161616';
/** 卓のフェルトの緑（背景の地の色を画面に出したときの色） */
const FELT = 'rgb(9,66,42)';

export const blackjackCard: OgCard = {
  alt: 'DOPAGAKI GAMES のブラックジャック',
  render: () => (
    <Frame background={FELT}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 56 }}>
        <div style={{ display: 'flex' }}>
          <PlayingCard rank="A" kind="spade" color={BLACK} style={{ transform: 'rotate(-8deg)' }} />
          <PlayingCard rank="K" kind="heart" color={RED} style={{ marginLeft: -70, marginTop: 40, transform: 'rotate(6deg)' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontFamily: DISPLAY_FONT, fontSize: 112, lineHeight: 1.05, color: '#ffffff', textShadow: GOLD_GLOW }}>
          <span>ブラック</span>
          <span>ジャック</span>
        </div>
      </div>
      <div style={{ display: 'flex', position: 'absolute', top: 56, left: 64 }}>
        <Wordmark size={40} />
      </div>
    </Frame>
  ),
};
