type Rgb = readonly [number, number, number];

/** カードの裏の印刷の色（Canvas の色の書き方）。地と格子 */
export const CARD_INK = { back: '#a3172b', backLine: '#cf5263' } as const;

/**
 * チップの色。CHIP_VALUES の順（5・10・25・100・500・1000・5000）に、地の色、縁の模様（差し色）、真ん中の額の文字の色。
 * カジノで多く使われる色分け（5 は赤、25 は緑、100 は黒、500 は紫、1000 は黄）に合わせる
 */
export const CHIP_COLORS: readonly { readonly base: string; readonly spot: string; readonly ink: string }[] = [
  { base: '#c41f2b', spot: '#f6f1e7', ink: '#a01822' },
  { base: '#1f54b8', spot: '#f6f1e7', ink: '#1a4699' },
  { base: '#1e8a3e', spot: '#f6f1e7', ink: '#17702f' },
  { base: '#1c1c1f', spot: '#f6f1e7', ink: '#1c1c1f' },
  { base: '#6b2d93', spot: '#f2d55c', ink: '#5a2380' },
  { base: '#f0b81c', spot: '#1c1c1f', ink: '#a8760a' },
  { base: '#8c4a24', spot: '#f2d55c', ink: '#733a1a' },
];

/** 卓のフェルトの地の色（深い緑）と、印刷の金 */
export const FELT_RGB: Rgb = [0.012, 0.11, 0.07];
export const FELT_PRINT = '#e8c66a';

/** 勝ちの光（金） */
export const GOLD_RGB: Rgb = [1.0, 0.82, 0.42];

/** 祝わないチップの動き（賭けたチップが戻る、勝ちでないラウンドの払い戻し）の粒の色 */
export const CHIP_DUST_RGB: Rgb = [0.55, 0.53, 0.48];

/** 負けの暗い煙の粒の色 */
export const SMOKE_RGB: Rgb = [0.22, 0.14, 0.3];

/** 背景の放射状の光と同心円の色相。プレイヤーの側と、ディーラーの側 */
export const PLAYER_LINE_HUE = 0.12;
export const DEALER_LINE_HUE = 0.08;
