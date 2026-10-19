/**
 * トランプのカード。1 組 52 枚の中の番号（0〜51）で表す。番号はスートごとに 13 枚ずつ並べ、各スートの中は A, 2, …, 10, J, Q, K の順。
 * 数値にしておくと、配列の添字や演出の値（シェーダー）へそのまま渡せる
 */
export type Card = number;

export const DECK_SIZE = 52;
export const RANKS = 13;

/** スート。スペード・ハート・ダイヤ・クラブ */
export const Suit = { Spade: 0, Heart: 1, Diamond: 2, Club: 3 } as const;
export type Suit = (typeof Suit)[keyof typeof Suit];

/** ランクの番号（0 が A、9 が 10、10 が J、11 が Q、12 が K） */
export const rankOf = (c: Card): number => c % RANKS;
export const suitOf = (c: Card): Suit => Math.floor(c / RANKS) as Suit;
export const cardOf = (suit: Suit, rank: number): Card => suit * RANKS + rank;

/** ハートとダイヤは赤いスート */
export const isRed = (s: Suit): boolean => s === Suit.Heart || s === Suit.Diamond;

/**
 * カードの点の種類（1〜10）。A は 1（手の合計で 11 にもなる）、絵札（J・Q・K）は 10。
 * 点が同じカードは、ブラックジャックの勝負では区別しない（10 と K のペアも分けられる）
 */
export const pointOf = (c: Card): number => Math.min(10, rankOf(c) + 1);

/** 点の種類の数（1〜10）。残りのカードの数を点ごとに数えるときの長さ */
export const POINTS = 10;

/** ランクの表記 */
export const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

const SUIT_NAMES = ['スペード', 'ハート', 'ダイヤ', 'クラブ'] as const;

/** 読み上げに使うカードの名前（「スペードの A」など） */
export const cardName = (c: Card): string => `${SUIT_NAMES[suitOf(c)]}の ${RANK_LABELS[rankOf(c)]}`;

/** カードの表記（parseCard の逆。"AS"、"10H" のように、ランクとスートの頭文字） */
export const cardCode = (c: Card): string => `${RANK_LABELS[rankOf(c)]}${'SHDC'[suitOf(c)]}`;

/**
 * 表記からカード（"AS"、"10H"、"KD"、"7C" のように、ランクとスートの頭文字 S・H・D・C）。読めなければ -1。
 * 開発用の操作口で、配るカードを並べるのに使う
 */
export function parseCard(text: string): Card {
  const m = /^(A|[2-9]|10|J|Q|K)([SHDC])$/.exec(text.toUpperCase());
  if (!m) return -1;
  const rank = RANK_LABELS.indexOf(m[1] as (typeof RANK_LABELS)[number]);
  const suit = 'SHDC'.indexOf(m[2]) as Suit;
  return cardOf(suit, rank);
}
