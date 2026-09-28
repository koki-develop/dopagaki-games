/**
 * 見た目の明るさの調整値。眩しさ（長く遊んだときの目の疲れ）に関わる値は、すべてここにまとめる。
 * 色の鮮やかさは各シェーダーの色で決め、ここでは明るさの強さだけを扱う。
 */
export const LOOK = {
  /** トーンマッピングの露出。全体の明るさ */
  exposure: 0.85,
  bloom: {
    /** これより暗い部分は光らせない。HDR で 1 を超える芯や縁だけが bloom する */
    threshold: 0.75,
    /** 演出が何も起きていないときの強さと広がり */
    base: 0.32,
    radius: 0.22,
    /** ボール数の段階 1 つあたり、intensity 1 あたりの上乗せ */
    perTier: 0.04,
    perIntensity: 0.14,
    radiusPerTier: 0.03,
    /** Peak とフィナーレの一時的なブーストに掛ける倍率 */
    boost: 0.4,
  },
  /** ステージクリアの炸裂で画面全体が明るくなる強さ */
  finaleFlash: 0.55,
  ball: {
    /** 白い芯と、色の付いた縁 */
    core: 1.2,
    halo: 0.6,
  },
  block: {
    edge: 1.25,
    edgeGlow: 0.25,
    fill: 0.16,
    innerFrame: 0.8,
    crack: 1.0,
    core: 0.75,
    corePulse: 0.35,
    /** 当たった瞬間に白く光る強さ */
    hitFlash: 0.6,
    /** 壊れないブロック: 板の塗り、斜めの縞、当たった瞬間の光 */
    solidFill: 0.3,
    solidStripe: 0.14,
    solidHitFlash: 0.3,
  },
  paddle: {
    edge: 1.2,
    edgeGlow: 0.2,
    centerLine: 0.9,
    fill: 0.35,
    hitFlash: 0.9,
  },
  /** 粒は数が多いと加算で眩しくなるので、発生時の色より抑えて描く */
  particles: 0.65,
  debris: {
    /** 落ちている間ずっと灯る明るさと、割れた直後だけ上乗せする明るさ */
    base: 0.22,
    flight: 0.8,
  },
  background: {
    grid: 0.08,
    gridBeat: 0.2,
    gridIntensity: 0.22,
    gridGlow: 0.35,
    gridDensity: 1.1,
    wall: 1.05,
    shock: 1.0,
  },
} as const;
