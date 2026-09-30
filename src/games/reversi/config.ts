import type { Side } from './types.ts';

/**
 * リバーシの動きと時間の調整値。時間は、特に書いていなければ世界時間の秒（スローモーションで伸び、ヒットストップで止まる）。
 * 実時間の秒のもの（HIT_STOP、MIN_THINK、AIR など）は、それぞれに書く。明るさの調整値は view/look.ts にある。
 * 素のモジュール（lint/pure-modules.ts）なので、ここから辿れる先も含めて環境に触れない。
 */

/** 1 手の演出。人の手と CPU の手で分ける */
export type ChoreoTuning = {
  /** 石が上から落ちて盤に着くまで */
  drop: number;
  /** 着いてから返り始めるまでの溜め（ヒットストップで止まる時間は含まない）。返る枚数が多いほど長い（holdPerFlip × 枚数、holdCap 枚まで） */
  holdBase: number;
  holdPerFlip: number;
  holdCap: number;
  /** 同じ向きで隣の石が返り始めるまでの間隔。返る枚数が多いほど短くする */
  stepMax: number;
  stepMin: number;
  stepPerFlip: number;
  /** 1 枚が返りきるまで。余分に回る 1 周ごとに flipPerSpin を足す */
  flipBase: number;
  flipPerSpin: number;
  /** 返るときに浮く高さ（石の半径を 1 とした倍率）。返る順番が後の石ほど高く浮く */
  liftBase: number;
  liftPerOrder: number;
  liftMax: number;
  /** 返る順番が spinsEvery 枚進むごとに、余分に 1 周回る（spinsMax 周まで）。0 なら回らない */
  spinsEvery: number;
  spinsMax: number;
  /** 最後の石が返りきってから、次の手番までの余韻 */
  settle: number;
};

export const CHOREO: Readonly<Record<Side, ChoreoTuning>> = {
  human: {
    drop: 0.08,
    holdBase: 0.02,
    holdPerFlip: 0.004,
    holdCap: 10,
    stepMax: 0.05,
    stepMin: 0.022,
    stepPerFlip: 0.003,
    flipBase: 0.2,
    flipPerSpin: 0.02,
    liftBase: 0.35,
    liftPerOrder: 0.05,
    liftMax: 1.1,
    spinsEvery: 4,
    spinsMax: 3,
    settle: 0.08,
  },
  // CPU の手は重く、遊びを入れない。回らず、低く返る
  cpu: {
    drop: 0.1,
    holdBase: 0.04,
    holdPerFlip: 0.004,
    holdCap: 10,
    stepMax: 0.045,
    stepMin: 0.03,
    stepPerFlip: 0.002,
    flipBase: 0.2,
    flipPerSpin: 0,
    liftBase: 0.18,
    liftPerOrder: 0.01,
    liftMax: 0.3,
    spinsEvery: 0,
    spinsMax: 0,
    settle: 0.08,
  },
};

/**
 * 1 手で返した枚数から決める演出の段階。人の手だけに使う。
 * 3 枚から段階 1、5 枚から 2、6 枚から 3、8 枚から 4。
 * この CPU との対局では、3 枚以上の手は人の手の 3 割ほど、5 枚以上は 1 割ほど、
 * 6 枚以上の手は 6〜8 割の対局で、8 枚以上の手は 1〜2 割の対局で出る
 */
const FLIP_TIERS = [3, 5, 6, 8] as const;

export function flipTier(flips: number): number {
  let tier = 0;
  while (tier < FLIP_TIERS.length && flips >= FLIP_TIERS[tier]) tier++;
  return tier;
}

/** 大きな手（無音の溜め、スローモーション、衝撃波）になる段階 */
export const BIG_TIER = 3;

/**
 * ヒットストップ。段階 1 以上の人の手で、石が盤に着いた瞬間に、打った石と返る石を止めて震わせる（実時間の秒）。
 * 段階ごとの長さで、コンボがフィーバーに入っていれば feverScale 倍にする
 */
export const HIT_STOP = {
  /** 段階 1〜4 の長さ。60fps で 5・7・10・14 フレーム */
  byTier: [0, 5 / 60, 7 / 60, 10 / 60, 14 / 60],
  /** 段階 4 で、8 枚を超えた 1 枚ごとに足す長さと、全体の上限（20 フレーム） */
  perExtraFlip: 1 / 60,
  max: 20 / 60,
  feverScale: 1.2,
} as const;

/** 人の手で flips 枚返したときのヒットストップの長さ（実時間の秒）。段階 0 は 0 */
export function hitStopFor(flips: number, fever: boolean): number {
  const tier = flipTier(flips);
  if (tier === 0) return 0;
  const extra = tier === FLIP_TIERS.length ? (flips - FLIP_TIERS[FLIP_TIERS.length - 1]) * HIT_STOP.perExtraFlip : 0;
  return Math.min(HIT_STOP.max, (HIT_STOP.byTier[tier] + extra) * (fever ? HIT_STOP.feverScale : 1));
}

/**
 * 大きな手のスローモーション。返り始めから最後の石が返りきるまでの世界時間のうち、cover の割合を scale 倍の遅さで保ち、
 * release 秒（実時間）かけて等速に戻す
 */
export const SLOW_MO = {
  /** 段階 3 と段階 4 の倍率 */
  scale: { big: 0.5, top: 0.3 },
  cover: 0.8,
  release: 0.45,
} as const;

/** CPU が考えている様子を見せる最短の時間（実時間の秒）。コンボのテンポを切らない短さにする */
export const MIN_THINK = 0.2;

/** 人がパスしたときに、パスの表示を出してから CPU の手番へ移るまで */
export const PASS_PAUSE = 0.6;

/** 対局の始まりの演出。盤が現れ、初期配置の 4 石が 1 つずつ落ちる */
export const INTRO = {
  /** 盤が現れきるまで */
  board: 0.35,
  /** 1 つの石が落ちて着くまで */
  drop: 0.16,
  /** 最初の石が落ち始める時刻と、次の石までの間隔 */
  firstDisc: 0.3,
  discInterval: 0.12,
  /** 石の多い局面から始めるときに、全部の石を落としきるまでの長さの上限 */
  maxSpread: 1.2,
  /** 最後の石が着いてから、最初の手番まで */
  settle: 0.25,
} as const;

/** 人の手が返りきった後の知らせを出す時刻（最後の石が返りきってから）。重ならないよう少しずつずらす */
export const AFTER_MOVE = {
  stable: 0.05,
  score: 0.05,
  best: 0.4,
  /** 最後の手で、最後の知らせを出してから終局の儀式までの間 */
  settle: 0.12,
} as const;

/** 大きな手で、着いてから無音の溜めに入るまで（AudioContext の秒）。着いた音の立ち上がりを消さない */
export const BIG_SILENCE_DELAY = 0.04;

/** カメラの揺れ（trauma 1 のときの平行移動と回転、trauma の 1 秒あたりの減少量、ノイズを進める速さ） */
export const CAMERA_RIG = { maxOffset: 0.3, maxRotation: 0.035, decayPerSecond: 1.3, frequency: 16 } as const;

/** カメラの引き。amount は zoom を下げる量（負なら寄る）、attack と release は引ききるまでと戻るまで */
export type PullTuning = { readonly amount: number; readonly attack: number; readonly release: number };

/**
 * 演出ごとのカメラの動き（trauma は揺れの量、pull と punch は引き）と、演出の強さ（kick、0〜1 の intensity を上げる量）、
 * 盤の波紋の強さ（ripple）。段階（tier）や枚数で強める値は base と per〜の足し算
 */
export const MOTION = {
  introDrop: { trauma: 0.05, ripple: 0.35 },
  humanLand: {
    trauma: { base: 0.16, perTier: 0.1 },
    punch: { base: 0.03, perTier: 0.02, attack: 0.03, release: 0.22 },
    ripple: { base: 0.8, perTier: 0.25 },
    /** 返した枚数 flipsForFull 枚で 1 */
    kick: { base: 0.2, flipsForFull: 10 },
  },
  /** 大きな手の、着いてから返り始めるまでの寄り（段階 3 を base とし、段階が 1 上がるごとに perTier） */
  bigHold: { amount: { base: -0.05, perTier: -0.02 }, attack: 0.08, release: 0.2 },
  /** 段階 2 以上の人の手の返り始め */
  wave: { trauma: { base: 0.15, perTier: 0.1 } },
  /** 大きな手の返り始めの引き（段階 3 を base とする）と、衝撃波の速さ（u / 秒） */
  bigWave: { amount: { base: 0.08, perTier: 0.03 }, attack: 0.15, release: 0.9, shockSpeed: { base: 9, perTier: 1 } },
  flipLand: {
    human: { trauma: { base: 0.03, perTier: 0.015 }, kick: { base: 0.1, stepsForFull: 14 } },
    cpu: { trauma: 0.04 },
  },
  /** CPU の手。重さは返した枚数 weightFlips 枚で 1 */
  cpuLand: { weightFlips: 8, trauma: { base: 0.18, perWeight: 0.2 }, ripple: { base: 0.5, perWeight: 0.4 } },
  /** CPU の手で minFlips 枚以上返したときの返り始め。重さは返した枚数 weightFlips 枚で 1 */
  cpuWave: { minFlips: 5, weightFlips: 10, trauma: 0.3 },
  corner: { human: { trauma: 0.35, pull: { amount: 0.05, attack: 0.12, release: 0.7 } }, cpu: { trauma: 0.3 } },
  pass: { human: 0.2, cpu: 0.1 },
  rejected: { trauma: 0.05 },
  newBest: { trauma: 0.4, pull: { amount: 0.06, attack: 0.12, release: 0.8 } },
} as const;

/** 振動のパターン（ms）。端末が対応しているときだけ、節目に限って使う */
export const HAPTICS = {
  /** ヒットストップ: base + perTier × 段階 */
  hitStop: { base: 12, perTier: 8 },
  big: 40,
  top: [40, 30, 80],
  corner: 35,
  newBest: [30, 40, 60],
  win: [50, 40, 120],
  perfect: [60, 50, 60, 50, 140],
} as const;

/**
 * 盤の波紋。盤の線を光らせ（view/board.ts）、石を跳ねさせる（view/discs.ts）。両方が同じ値で描くので、同じ波に見える。
 * 1 件あたり (x, y, 開始時刻, 強さ) を slots 件まで覚え、古いものから上書きする。
 * 前が進む速さ（u / 秒）、輪の太さ（大きいほど細い）、時間とともに弱まる速さ（1/秒）、描く長さ（present の秒）
 */
export const RIPPLE = { slots: 6, speed: 9, width: 4, decay: 1.8, life: 2.5 } as const;

/**
 * 背景を走る衝撃波（大きな手と終局の決着）。1 件あたり (x, y, 開始時刻, 速さ) を slots 件まで覚え、古いものから上書きする。
 * 輪の太さ（大きいほど細い）、時間とともに弱まる速さ（1/秒）、描く長さ（present の秒）
 */
export const SHOCKWAVE = { slots: 4, width: 1.4, decay: 1.2, life: 3.5 } as const;

/**
 * 画面全体の空気（fx/atmosphere.ts）の動き。時間はすべて実時間の秒で、ヒットストップの間も動く。
 * 〜Tau は滑らかに寄せる時定数（秒）、decay は減衰の速さ（1/秒）
 */
export const AIR = {
  turnTau: 0.25,
  feverTau: 0.3,
  glowTau: 1.2,
  /** 演出の強さの目標は 1 秒あたり fall ずつ下がり、今の値は上がるときに riseTau、下がるときに fallTau で寄せる */
  intensity: { fall: 0.35, riseTau: 0.05, fallTau: 0.6 },
  decay: { dread: 1.4, rays: 1.1, rainbow: 0.5, flash: 9, boost: 3, aberration: 7 },
  /** 背景の色相が 1 秒（世界時間）に回る量（周） */
  hue: { base: 0.004, perIntensity: 0.03 },
  /** ビートの直後の光の立ち下がりの鋭さ */
  beatSharpness: 7,
  /** BGM の終盤の高まりに渡す割合 */
  riserBgm: 0.7,
  /** ヒットストップの RGB のずれ（画面の幅に対する割合、amp はヒットストップの強さ）。向きは実時間 × angleRate（ラジアン）で毎回変える */
  aberration: { base: 0.004, perAmp: 0.008, angleRate: 2.3 },
  /** ヒットストップの集中線の強さ: base + amp */
  impact: { base: 0.4 },
  /** ヒットストップの強さ: base + perTier × 段階 */
  hitAmp: { base: 0.45, perTier: 0.15 },
  /** 虹色の強さ 1 のときに、盤の線の色相が 1 秒で回る量（周） */
  rainbowTurnsPerSecond: 0.6,
  /** 終盤の高まりを始める空きマスの数 */
  riserEmpties: 14,
} as const;

/** 押している・ホバーしているマスとカーソルの光を寄せる速さ（1/秒、実時間） */
export const POINTER_RATE = 18;

/** 終局の儀式の時間 */
export const CEREMONY = {
  /** 全部の石が跳ねてから、最初の組を移し始めるまで */
  lift: 0.35,
  /**
   * 1 つの移し替え: 元の位置で縮んで消えるまで（vanish）、消えたまま移っている間（travel）、並べ直す位置に現れきるまで（appear）。
   * 現れ始めた瞬間に、その石を数える
   */
  warp: { vanish: 0.09, travel: 0.15, appear: 0.14 },
  /** 1 組ずつ移し始める間隔。最初は gapStart で、1 組ごとに gapDecay 倍し、gapMin より短くしない */
  gapStart: 0.11,
  gapDecay: 0.9,
  gapMin: 0.028,
  /** 最後の組を数えてから溜めに入るまで。数え終えた集計を見せておく */
  countHold: 0.45,
  /** 決着までの溜め（無音） */
  hush: 0.45,
  /** 決着から、人の石が中心から外へ跳ねる波まで。波は中心からの距離 1 あたり waveStep 遅れて届く */
  waveLead: 0.7,
  waveStep: 0.035,
  /** 波を出してから結果画面まで（勝ち、パーフェクト、それ以外）。集計と決着を並べて見せておく */
  settleWin: 1.7,
  settlePerfect: 2.1,
  settleOther: 1.4,
  /** 勝ちの花火を、決着からこの長さの間にばらけて打ち上げる（present の秒） */
  fireworksSpread: 0.4,
} as const;

/** 移し替えを始めてから、並べ直す位置に現れ始めるまで（その石を数える時刻） */
export const WARP_ARRIVE = CEREMONY.warp.vanish + CEREMONY.warp.travel;

/** 終局の儀式のカメラの動き（trauma、pull）と演出の強さ（kick）、衝撃波の速さ（u / 秒） */
export const CEREMONY_MOTION = {
  start: { pull: { amount: 0.04, attack: 0.4, release: 1.2 } },
  /** 数えるたびの揺れ（両側を同時に数えるときは both）と、勝ちで人の石を数えるたびの強さ（discsForFull 個で 1） */
  tick: { trauma: 0.04, bothTrauma: 0.02, kick: { base: 0.2, discsForFull: 40 } },
  win: { trauma: 0.6, kick: 1, shockSpeed: 11, pull: { amount: 0.1, attack: 0.12, release: 1.2 } },
  /** パーフェクトで、決着の衝撃波から遅れて重ねる 2 つ目の衝撃波（遅れは present の秒） */
  perfect: { delay: 0.3, shockSpeed: 15 },
  lose: { trauma: 0.25, pull: { amount: -0.03, attack: 0.3, release: 1.0 } },
  draw: { trauma: 0.15 },
  wave: { shockSpeed: 9, pull: { amount: 0.06, attack: 0.1, release: 0.8 } },
} as const;
