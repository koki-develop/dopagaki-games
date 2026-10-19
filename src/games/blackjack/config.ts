/**
 * ブラックジャックの動きと時間の調整値。時間は、特に書いていなければ世界時間の秒（スローモーションで伸び、ヒットストップで止まる）。
 * 実時間の秒のもの（HIT_STOP、AIR など）は、それぞれに書く。明るさの調整値は view/look.ts にある。
 * 素のモジュール（lint/pure-modules.ts）なので、ここから辿れる先も含めて環境に触れない。
 */

/** プレイの始まり: 卓が現れてから、最初のラウンドの賭けを選び始める */
export const INTRO = {
  /** 卓が現れきるまで */
  table: 0.4,
  /** 最初のラウンドの賭けを選び始めるまで */
  firstBet: 0.45,
} as const;

/**
 * カードを配る。シューから弧を描いて飛び、手の位置に叩きつける。
 * 表で配るカードは、飛んでいる途中（flipFrom〜flipTo の割合）で裏から表へ返る
 */
export const DEAL = {
  /** 最初の 4 枚の 1 枚が飛ぶ長さと、次の 1 枚を出すまでの間隔 */
  fly: 0.26,
  gap: 0.15,
  /** 引いた 1 枚・分けた手の 2 枚目・ディーラーが引く 1 枚の飛ぶ長さ */
  draw: 0.22,
  flipFrom: 0.3,
  flipTo: 0.92,
  /** 飛ぶ間の見かけの高さ（大きく見え、影が離れる） */
  lift: 0.9,
  /** 1 枚を配り終えてから、次の出来事まで */
  settle: 0.08,
} as const;

/**
 * 溜め。結果の分からないカード（引いた 1 枚がバーストするか、ディーラーの 1 枚でラウンドに勝つか）は、
 * 伏せたまま置いて溜めてから返す。分からなさ（tension、0〜1）が from 以上のときだけ溜め、長さは分からなさに比例させる。
 * 分からなさが big 以上で、しかも配る前の手持ちのうち bigStake 以上を場に賭けている（ダブルと分けた分を含む）ときだけ、
 * 大きな溜めにする: 溜めの間を無音にしてドラムロールを鳴らし、画面の縁から絞り込み、カメラを寄せる。
 * 分からなさは五分五分に近いカードでほぼ 1 になり、ふつうの賭けでも 1 ラウンドに 1〜2 回は big を超えるので、
 * 大きな溜めは賭けの大きさで絞り（プレイヤーが手持ちの多くを懸けた 1 枚にだけ付ける）、1 ラウンドに 1 回までにする
 */
export const SUSPENSE = {
  from: 0.3,
  big: 0.7,
  bigStake: 0.2,
  hold: { base: 0.1, perTension: 0.5 },
  /** 溜めた後に返す長さ */
  flip: { base: 0.14, perTension: 0.16 },
  /** 溜めない 1 枚を、置いた場所で返す長さ（ディーラーの伏せたカード） */
  quickFlip: 0.16,
} as const;


/**
 * 操作の先行入力: 操作を待つまで残り INPUT_BUFFER 秒（世界時間）以内に押した操作は覚えておき、待ち始めた瞬間に選ぶ。
 * 操作を待ち始めるのは、最後に配った 1 枚が表になってから DEAL.settle 後なので、その間（カードの結果が見えた後）だけにする。
 * これより長くすると、表になる前に押した操作が、バーストして操作を待たない場合（黙って捨てる）とで違う返り方をし、結果を先に漏らす
 */
export const INPUT_BUFFER = DEAL.settle;

/** ディーラーが A か 10 点を見せたときに、伏せたカードの角を持ち上げて確かめる長さ（溜めない） */
export const PEEK = { duration: 0.45 } as const;

/** 操作の演出の長さ */
export const ACTION = {
  /** 分ける: 2 枚目が新しい手へ滑り、賭けのチップが手持ちから飛んでくる */
  split: 0.3,
  /** ダブル: 賭けのチップが手持ちから飛んでくる */
  double: 0.22,
  /** 止める */
  stand: 0.12,
  /** バースト */
  bust: 0.5,
  /** ブラックジャック（スローモーションで伸びる） */
  natural: 0.85,
  /** ディーラーのブラックジャック */
  dealerNatural: 0.6,
  /** ディーラーが引き終えた */
  dealerDone: 0.25,
  dealerBust: 0.55,
} as const;

/** 手ごとの精算: チップが飛ぶ長さ、1 枚ごとのずれ、次の手までの間 */
export const SETTLE = { fly: 0.3, chipGap: 0.035, handGap: 0.2, end: 0.1 } as const;

/**
 * ラウンドの締め: 増減の文字と連勝を出し、場のチップを手持ちへ集め、カードを捨てる。
 * 集めるチップは 1 枚ずつずらして手持ちへ飛ばし、着いたときに HUD の手持ちへ入れる
 */
export const SUMMARY = {
  lead: 0.1,
  /** 増減の文字を見せてから集め始めるまで（勝ちの段階が上がるほど長く見せる） */
  hold: { base: 0.35, perLevel: 0.12 },
  collectFly: 0.42,
  collectGap: 0.03,
  /** カードを捨てる: 1 枚が飛ぶ長さと、1 枚ごとのずれ */
  sweep: 0.3,
  sweepGap: 0.02,
  /** 捨て終えてから次のラウンドを配り始めるまで */
  next: 0.2,
} as const;

/**
 * 勝ったラウンドの増減（連勝の上乗せを含む）の、配る前の手持ちに対する比から決める演出の段階。
 * 同じ額でも、手持ちの大半を賭けた勝ちほど大きく見せる。0.2 から段階 1、0.4 から 2、0.8 から 3、1.6 から 4。
 * 手持ちの 1 割を賭けて勝てば段階 0、ダブルで勝つか ×2 の倍率で勝てば段階 1、手持ちをすべて賭けて勝てば段階 3、
 * 手持ちをすべて賭けて ×2 以上の倍率で勝てば段階 4
 */
const PAYOUT_TIERS = [0.2, 0.4, 0.8, 1.6] as const;

export function payoutTier(share: number): number {
  let tier = 0;
  while (tier < PAYOUT_TIERS.length && share >= PAYOUT_TIERS[tier]) tier++;
  return tier;
}

/** 大きな勝ち（無音の溜め、スローモーション、衝撃波）になる段階 */
export const BIG_TIER = 3;

/**
 * ヒットストップ（実時間の秒）。ブラックジャックと、段階 1 以上の勝ちの払い戻しで、チップとカードを止めて震わせる。
 * 段階ごとの長さで、フィーバーなら feverScale 倍にし、max を超えない
 */
export const HIT_STOP = {
  /** 段階 1〜4 の長さ。60fps で 5・7・10・14 フレーム */
  byTier: [0, 5 / 60, 7 / 60, 10 / 60, 14 / 60],
  natural: 12 / 60,
  max: 20 / 60,
  feverScale: 1.2,
} as const;

/** 勝ちの段階 tier（0〜4）のヒットストップの長さ（実時間の秒） */
export function hitStopFor(tier: number, fever: boolean): number {
  if (tier <= 0) return 0;
  return Math.min(HIT_STOP.max, HIT_STOP.byTier[Math.min(4, tier)] * (fever ? HIT_STOP.feverScale : 1));
}

/** スローモーション（ブラックジャックと大きな勝ち）。scale 倍の遅さを hold 秒（世界時間）保ち、release 秒（実時間）かけて戻す */
export const SLOW_MO = { natural: { scale: 0.35, hold: 0.35 }, big: { scale: 0.45, hold: 0.3 }, release: 0.5 } as const;

/** 溜めの無音を、着いた音の立ち上がりを聞かせてから始めるまで（AudioContext の秒） */
export const SILENCE_DELAY = 0.04;

/** カメラの揺れ（trauma 1 のときの平行移動と回転、trauma の 1 秒あたりの減少量、ノイズを進める速さ） */
export const CAMERA_RIG = { maxOffset: 0.3, maxRotation: 0.03, decayPerSecond: 1.3, frequency: 16 } as const;

/** カメラの引き。amount は zoom を下げる量（負なら寄る）、attack と release は引ききるまでと戻るまで */
export type PullTuning = { readonly amount: number; readonly attack: number; readonly release: number };

/**
 * 演出ごとのカメラの動き（trauma は揺れの量、pull と punch は引き）と、演出の強さ（kick、0〜1 の intensity を上げる量）。
 * 段階（tier）で強める値は base と perTier の足し算
 */
export const MOTION = {
  /** カードが手に着いた。プレイヤーの選んだ 1 枚は少し強く */
  land: { trauma: 0.03, chosen: 0.07 },
  /** 溜めの寄り（分からなさ 1 のとき） */
  suspense: { pull: { amount: -0.05, attack: 0.25, release: 0.3 } },
  bust: { trauma: 0.28, pull: { amount: -0.025, attack: 0.15, release: 0.6 } },
  natural: { trauma: 0.55, kick: 1, pull: { amount: 0.08, attack: 0.12, release: 0.9 }, punch: { amount: 0.05, attack: 0.03, release: 0.25 } },
  dealerNatural: { trauma: 0.35 },
  dealerBust: { trauma: 0.3, kick: 0.45 },
  twentyOne: { trauma: 0.12, kick: 0.35 },
  /** 勝ったラウンドの払い戻し */
  payout: {
    trauma: { base: 0.12, perTier: 0.1 },
    kick: { base: 0.3, perTier: 0.17 },
    punch: { base: 0.02, perTier: 0.015, attack: 0.03, release: 0.22 },
    big: { pull: { amount: 0.07, attack: 0.12, release: 0.9 }, shockSpeed: { base: 9, perTier: 1.5 } },
  },
  /** 負けたラウンド */
  loss: { trauma: 0.12 },
  streak: { trauma: 0.08 },
  chipLand: { trauma: 0.01 },
  rejected: { trauma: 0.05 },
  finalRound: { trauma: 0.15 },
  newBest: { trauma: 0.4, pull: { amount: 0.06, attack: 0.12, release: 0.8 } },
} as const;

/** 振動のパターン（ms）。端末が対応しているときだけ、節目に限って使う */
export const HAPTICS = {
  natural: [40, 30, 90],
  hitStop: { base: 12, perTier: 8 },
  big: 40,
  top: [40, 30, 80],
  newBest: [30, 40, 60],
  profit: [50, 40, 120],
} as const;

/**
 * 背景を走る衝撃波（ブラックジャック、大きな勝ち、終わりの決着）。1 件あたり (x, y, 開始時刻, 速さ) を slots 件まで覚え、古いものから上書きする。
 * 輪の太さ（大きいほど細い）、時間とともに弱まる速さ（1/秒）、描く長さ（present の秒）
 */
export const SHOCKWAVE = { slots: 4, width: 1.4, decay: 1.2, life: 3.5 } as const;

/**
 * 画面全体の空気（fx/atmosphere.ts）の動き。時間はすべて実時間の秒で、ヒットストップの間も動く。
 * 〜Tau は滑らかに寄せる時定数（秒）、decay は減衰の速さ（1/秒）
 */
export const AIR = {
  feverTau: 0.3,
  glowTau: 1.2,
  focusTau: 0.12,
  activeTau: 0.12,
  /** 演出の強さの目標は 1 秒あたり fall ずつ下がり、今の値は上がるときに riseTau、下がるときに fallTau で寄せる */
  intensity: { fall: 0.35, riseTau: 0.05, fallTau: 0.6 },
  decay: { dread: 1.2, rays: 1.1, rainbow: 0.5, flash: 9, boost: 3, aberration: 7 },
  /** 背景の色相が 1 秒（世界時間）に回る量（周） */
  hue: { base: 0.004, perIntensity: 0.03 },
  /** ビートの直後の光の立ち下がりの鋭さ */
  beatSharpness: 7,
  /** ヒットストップの RGB のずれ（画面の幅に対する割合、amp はヒットストップの強さ）。向きは実時間 × angleRate（ラジアン）で毎回変える */
  aberration: { base: 0.004, perAmp: 0.008, angleRate: 2.3 },
  /** ヒットストップの集中線の強さ: base + amp */
  impact: { base: 0.4 },
  /** ヒットストップの強さ: base + perTier × 段階 */
  hitAmp: { base: 0.45, perTier: 0.15 },
  /** 虹色の強さ 1 のときに、卓の線の色相が 1 秒で回る量（周） */
  rainbowTurnsPerSecond: 0.6,
} as const;

/** 終わりの儀式の時間 */
export const CEREMONY = {
  /** 場が片付いてから、溜めに入るまで */
  lead: 0.35,
  /** 決着までの溜め（ほかの音を消す） */
  hush: 0.7,
  /** 決着から、最高スコアの更新を知らせるまで（記録を超えて終えたときだけ） */
  newBestAfter: 0.6,
  /** 決着から結果画面まで（増やした、それ以外） */
  settleProfit: 1.7,
  settleOther: 1.3,
  /** 増やしたときの花火を、決着からこの長さの間にばらけて打ち上げる（present の秒） */
  fireworksSpread: 0.45,
} as const;

/** 終わりの儀式のカメラの動き（trauma、pull）と演出の強さ（kick）、衝撃波の速さ（u / 秒） */
export const CEREMONY_MOTION = {
  start: { pull: { amount: 0.03, attack: 0.4, release: 1.2 } },
  profit: { trauma: 0.6, kick: 1, shockSpeed: 11, pull: { amount: 0.1, attack: 0.12, release: 1.2 } },
  loss: { trauma: 0.25, pull: { amount: -0.03, attack: 0.3, release: 1.0 } },
  even: { trauma: 0.15 },
} as const;
