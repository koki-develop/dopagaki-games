/**
 * 見た目の明るさの調整値。眩しさ（長く遊んだときの目の疲れ）に関わる値は、すべてここにまとめる。
 * 色の鮮やかさは palette.ts で決め、ここでは明るさの強さだけを扱う。
 */
export const LOOK = {
  /** トーンマッピングの露出。全体の明るさ */
  exposure: 0.85,
  bloom: {
    /**
     * これより暗い部分は光らせない。カードの紙・チップ・卓の印刷は閾値より暗くして光らせず、
     * 演出の光（粒、勝ちの光、衝撃波、放射状の光）だけが bloom する
     */
    threshold: 0.95,
    /** 何も起きていないときの強さと広がり */
    base: 0.3,
    radius: 0.25,
    /** intensity 1 あたりの上乗せ */
    perIntensity: 0.22,
    /** 一時的なブースト（ブラックジャック、大きな勝ち、最高スコアの更新、終わり）に掛ける倍率 */
    boost: 0.45,
  },
  card: {
    /** 紙の明るさ（白い紙が bloom の閾値を超えない明るさ） */
    paper: 0.9,
    /** 卓に叩きつけた瞬間の白い光 */
    land: 0.35,
    /** 勝った手と、ブラックジャックの手の光（カードの縁の内側と外へにじむ光。絵柄が白く飛ばない強さ） */
    win: 0.55,
    /** 暗くした（負けた）カードの明るさの倍率 */
    dim: 0.38,
    /** 影の濃さ */
    shadow: 0.55,
  },
  chip: {
    /** チップの上の面と側面の明るさ */
    face: 0.88,
    /** 取られるチップの明るさの倍率 */
    dim: 0.35,
    /** 勝ったラウンドの払い戻しのチップの縁を走る光 */
    shine: 1.6,
    /** 影の濃さ */
    shadow: 0.5,
  },
  table: {
    /** フェルトの印刷（金）の明るさ */
    print: 0.75,
    lineBeat: 0.35,
    /** 手が分かれたときの賭けの丸 */
    spot: 0.6,
    /** 操作を待っている手のまわりの光 */
    active: 0.9,
    /** 最後のラウンドの縁の光 */
    finalRound: 0.5,
  },
  background: {
    base: 0.02,
    /** フィーバーの間の、中心の光の上乗せ */
    fever: 2.5,
    rays: 0.45,
    rings: 0.12,
    shock: 1.0,
  },
  /** ヒットストップの集中線の明るさ */
  impactLines: 0.9,
  /** 粒は数が多いと加算で眩しくなるので、発生時の色より抑えて描く */
  particles: 0.7,
  /** 画面全体が明るくなる強さ */
  flash: 0.42,
  /** 溜めで画面の縁を暗くする濃さ */
  focusDarkness: 0.72,
  /**
   * 演出ごとの光と暗さ。flash は LOOK.flash に掛ける割合、boost は bloom の一時的なブースト（LOOK.bloom.boost を掛ける前）、
   * rays は背景の放射状の光、prism は卓の線の虹色、dark は負けの暗さ（どれも 0〜1 の目安）。
   * 段階（tier）で強める値は base と perTier の足し算
   */
  moments: {
    natural: { flash: 0.6, boost: 1.4, rays: 1, prism: 0.9 },
    /** 勝ったラウンドの払い戻し */
    payout: { flash: { base: 0, perTier: 0.2 }, boost: { base: 0.3, perTier: 0.28 }, rays: { base: 0.2, perTier: 0.2 }, topPrism: 1 },
    twentyOne: { boost: 0.5 },
    dealerBust: { boost: 0.6, rays: 0.4 },
    bust: { dark: 0.45 },
    dealerNatural: { dark: 0.6 },
    /** 負けたラウンド: 失った額の、配る前の手持ちに対する比 1 あたりの暗さ */
    loss: { dark: { base: 0.2, perShare: 0.8, max: 0.6 } },
    newBest: { rays: 1, prism: 0.6, boost: 1.4 },
    profit: { flash: 1, boost: 1.3, rays: 1, prism: 0.8 },
    lossEnd: { dark: 0.6 },
  },
} as const;
