/**
 * 見た目の明るさの調整値。眩しさ（長く遊んだときの目の疲れ）に関わる値は、すべてここにまとめる。
 * 色の鮮やかさは palette.ts で決め、ここでは明るさの強さだけを扱う。
 */
export const LOOK = {
  /** トーンマッピングの露出。全体の明るさ */
  exposure: 0.85,
  bloom: {
    /** これより暗い部分は光らせない。HDR で 1 を超える石の縁や線の芯だけが bloom する */
    threshold: 0.8,
    /** 何も起きていないときの強さと広がり */
    base: 0.3,
    radius: 0.25,
    /** intensity 1 あたりの上乗せ */
    perIntensity: 0.22,
    /** 一時的なブースト（大きな手、角、最高スコアの更新、終局）に掛ける倍率 */
    boost: 0.45,
  },
  disc: {
    /** 白い面の明るさ。bloom の閾値より暗くして、面全体は光らせない */
    whiteFace: 0.74,
    /** 黒い面の明るさ */
    blackFace: 0.09,
    /** 縁の光（ネオン）。この強さだけが bloom する */
    rim: 1.3,
    /** 石の外側へにじむ縁の光の不透明度 */
    halo: 0.35,
    /** 厚みの面の明るさ */
    edge: 0.4,
    /** 左上からの光の照り返し */
    specular: 0.5,
    /** 確定石の結晶の光 */
    stable: 0.9,
    /** 合法手の印。フィーバーの間はビートで脈打つ */
    marker: 0.9,
    /** 押している間の半透明の石 */
    ghost: 0.5,
    /** 人の石が着いた瞬間と、終局の並べ直しで石が現れた瞬間に白く光る強さ */
    impact: 1.6,
  },
  board: {
    /** 盤面の地の明るさ */
    surface: 0.05,
    /** マスの線 */
    grid: 0.5,
    gridBeat: 0.35,
    gridIntensity: 0.4,
    /** 枠の光 */
    frame: 1.1,
    /** 波紋が通るときに線が光る強さ */
    ripple: 1.2,
    /** カーソルとホバーのマスの光 */
    cursor: 0.5,
    /** 最後に打ったマスの光 */
    lastMove: 0.6,
  },
  background: {
    base: 0.02,
    /** 終盤の高まり（0〜1）1 あたりの、中心の光の上乗せ */
    riserGlow: 0.8,
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
  /** 大きな手と終局で画面全体が明るくなる強さ */
  flash: 0.42,
  /**
   * 演出ごとの光と暗さ。flash は LOOK.flash に掛ける割合、boost は bloom の一時的なブースト（LOOK.bloom.boost を掛ける前）、
   * rays は背景の放射状の光、prism は盤の線の虹色、dark は CPU の重い手の暗さ（どれも 0〜1 の目安）。
   * 段階（tier）や重さで強める値は base と per〜の足し算
   */
  moments: {
    /** ヒットストップの閃光 */
    hitFlash: { base: 0.25, perTier: 0.15 },
    /** 段階 2 以上の返り始め */
    wave: { boost: { base: 0.5, perTier: 0.25 }, rays: { base: 0.4, perTier: 0.2 } },
    /** 大きな手の返り始め（段階 3 と段階 4） */
    bigFlash: { big: 0.6, top: 1 },
    topPrism: 1,
    corner: { boost: 0.9, cpuDark: 0.6 },
    newBest: { rays: 1, prism: 0.6, boost: 1.4 },
    /** CPU の手が着いた（重さ 0〜1）と、多く返した返り始め（1 枚ごとに perFlip、max まで） */
    cpuLand: { dark: { base: 0.15, perWeight: 0.35 } },
    cpuWave: { dark: { base: 0.5, perFlip: 1 / 25, max: 0.4 } },
    /** 終局の決着と、勝ちの締めの波（決着の虹色はパーフェクトだけ。締めの波はどの勝ちも虹色） */
    win: { flash: 1, boost: 1.3, perfectBoost: 1.8, rays: 1, perfectPrism: 1, wavePrism: 0.8 },
    lose: { dark: 0.6 },
  },
} as const;
