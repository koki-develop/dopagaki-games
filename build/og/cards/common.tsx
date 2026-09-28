import type { ReactNode } from 'react';
import { OG_HEIGHT, OG_WIDTH } from '../card.ts';
import { DISPLAY_FONT } from '../fonts.ts';

// アプリの色（src/app/styles.css のトークン）と同じ値
const BG = 'rgb(2,1,8)';
const CYAN = 'rgb(94,242,255)';

/** 画像の全面を暗い地で覆い、中身を上下左右の中央に置く */
export function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: OG_WIDTH,
        height: OG_HEIGHT,
        background: BG,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </div>
  );
}

/**
 * ポータルと同じロゴ。白い DOPAGAKI に、シアンの GAMES を字間を広げて添える。
 * 大きさと字間の比はポータルの CSS（.portal-logo）に合わせる
 */
export function Wordmark({ size }: { size: number }) {
  const sub = size * 0.39;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', fontFamily: DISPLAY_FONT, lineHeight: 0.92 }}>
      <span style={{ fontSize: size, color: '#ffffff', textShadow: `0 0 ${size * 0.23}px rgba(94,242,255,0.35)` }}>DOPAGAKI</span>
      <span style={{ marginTop: sub * 0.35, fontSize: sub, letterSpacing: '0.6em', color: CYAN }}>GAMES</span>
    </div>
  );
}
