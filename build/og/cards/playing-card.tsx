import type { CSSProperties } from 'react';
import { DISPLAY_FONT } from '../fonts.ts';

/** カードの紙の色（src/games/blackjack/view/card-art.ts の紙） */
const PAPER = '#fbfaf5';

/** スートの形（幅と高さ 100 の枠に置いたもの） */
const SUIT_PATH = {
  spade: 'M50 0C40 14 0 38 0 60C0 78 13 87 26 87C36 87 44 82 47 75C46 86 40 94 30 100L70 100C60 94 54 86 53 75C56 82 64 87 74 87C87 87 100 78 100 60C100 38 60 14 50 0Z',
  heart: 'M50 95C40 83 0 56 0 33C0 14 14 3 26 3C39 3 47 12 50 23C53 12 61 3 74 3C86 3 100 14 100 33C100 56 60 83 50 95Z',
} as const;

function Suit({ kind, size, color }: { kind: keyof typeof SUIT_PATH; size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <path d={SUIT_PATH[kind]} fill={color} />
    </svg>
  );
}

/** 本物のトランプのように、白い紙の左上にランクとスート、真ん中に大きなスート */
export function PlayingCard({ rank, kind, color, style }: { rank: string; kind: keyof typeof SUIT_PATH; color: string; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
        width: 170,
        height: 238,
        borderRadius: 12,
        background: PAPER,
        boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
        ...style,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'absolute', top: 12, left: 14, fontFamily: DISPLAY_FONT, fontSize: 40, lineHeight: 1, color }}>
        <span>{rank}</span>
        <Suit kind={kind} size={26} color={color} />
      </div>
      <Suit kind={kind} size={96} color={color} />
    </div>
  );
}

