/**
 * フィールドの幾何。ゲームの前提になる値なので、実行中には変えない。
 * 座標系は左下原点、y が上向き。単位は論理ユニット（u）。
 */
export const FIELD_W = 9;
export const FIELD_H = 16;
/** 奈落の上端。ここから下はパドルで拾えない */
export const PIT_TOP = 1.5;
export const PADDLE_Y = 1.8;
export const DANGER_Y = 4.0;

/**
 * ブロックの格子。左右の壁との間に隙間を空け、ボールが脇を抜けてブロックの裏へ回り込めるようにする。
 * 隙間はボールの直径より十分に広くする。
 */
const GRID_SIDE_GAP = 0.6;
export const GRID_LEFT = GRID_SIDE_GAP;
const GRID_RIGHT = FIELD_W - GRID_SIDE_GAP;
export const COLS = 12;
export const CELL_W = (GRID_RIGHT - GRID_LEFT) / COLS;
export const CELL_H = 0.36;
export const BLOCK_W = CELL_W - 0.05;
export const BLOCK_H = CELL_H - 0.05;
export const BLOCK_INSET_X = (CELL_W - BLOCK_W) / 2;
export const BLOCK_INSET_Y = (CELL_H - BLOCK_H) / 2;

export const BALL_RADIUS = 0.1;
export const BALL_CAP = 500;

export const STEP_HZ = 120;
export const STEP_DT = 1 / STEP_HZ;

/** ブロックの種類。Solid（壊れないブロック）はボールを跳ね返すだけで、HP を持たず、ステージにだけ置く */
export const BlockType = {
  Empty: 0,
  Ball: 1,
  Hard: 2,
  Mega: 3,
  Solid: 4,
} as const;
export type BlockType = (typeof BlockType)[keyof typeof BlockType];

/** 壊せるブロックの種類か。空きと Solid は壊せない */
export function isBreakable(type: number): boolean {
  return type !== BlockType.Empty && type !== BlockType.Solid;
}

/**
 * 調整用のパラメータ。開発ビルドの調整パネルから実行中に書き換えられるように、可変オブジェクトとして持つ。
 * sim はプレイの開始時に `snapshotTuning()` で取った写しだけを読むので、書き換えは次のプレイから効く。
 */
export const tuning = {
  paddle: {
    width: 2.0,
    height: 0.26,
    maxBounceDeg: 60,
    dragGain: 1.0,
    launchTiltMaxDeg: 20,
    /** この速さ（u/s）でパドルを動かしながら離すと、発射角が最大まで傾く */
    launchTiltFullSpeed: 14,
  },
  ball: {
    speedStart: 9,
    speedMax: 13,
    speedRampSeconds: 180,
    minDegFromHorizontal: 15,
  },
  blocks: {
    ballsFromBall: 1,
    ballsFromHard: 2,
    ballsFromMega: 6,
    /** 壊したボールが跳ね返った向きを中心に、この角度（±）の扇へボールを出す */
    spreadDeg: 25,
    megaSpreadDeg: 60,
  },
  endless: {
    initialRows: 15,
    /** 降下速度（行 / 秒）。ブロックはこの速さぶんの時間ごとに 1 段ずつ落ちる。時間とともに上限なく上がり続ける */
    descentStart: 0.1,
    /** 1 分ごとに増える降下速度（行 / 秒） */
    descentAccelPerMinute: 0.3,
    /** 1 段の降下にかける時間。短く、ガクンと落とす */
    stepDropSeconds: 0.12,
    penaltyRows: 3,
    penaltyDropSeconds: 0.28,
    hardRatioStart: 0.14,
    hardRatioMax: 0.8,
    hardRatioRampSeconds: 300,
    megaRatio: 0.01,
    /** ブロックの帯の行数（この範囲からランダム）。帯と帯の間に、横一直線の空の行を挟む */
    bandRowsMin: 4,
    bandRowsMax: 7,
    /** 帯の間に挟む空の行数 */
    gapRowsMin: 1,
    gapRowsMax: 2,
    /** ハードの HP は hardHpStart × (1 + 時間 / hardHpScaleSeconds) ^ hardHpPower */
    hardHpStart: 2,
    hardHpScaleSeconds: 45,
    hardHpPower: 1.7,
    /** ハードの HP の上限。これより硬いブロックは作らない */
    hardHpMax: 24,
    /** 全消しの直後に天井の外から落とし入れる行数 */
    refillRows: 12,
    refillDropSeconds: 0.45,
    /** この秒数ごとに、外周をハードで囲み中をメガで埋めた帯（ジャックポット）を 1 つ出す */
    jackpotIntervalSeconds: 120,
    /** ジャックポットの帯の行数（上下の縁の行を含む） */
    jackpotRows: 7,
  },
  stage: {
    lives: 3,
  },
  score: {
    chainWindow: 0.5,
    chainDivisor: 20,
    chainMultMax: 5,
    pointsBall: 10,
    pointsHardPerHp: 10,
    pointsMega: 50,
    pointsOverflow: 10,
    pointsClearBall: 10,
  },
};

export type Tuning = typeof tuning;

type DeepReadonly<T> = { readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K] };

/** sim が読む調整値。プレイの開始時に取った写しで、プレイ中は変わらない */
export type SimConfig = DeepReadonly<Tuning>;

/** 調整値 1 つの許容範囲。int なら整数に丸める */
export type TuningRange = { readonly min: number; readonly max: number; readonly int?: boolean };

/** フィールドの高さに収まる行数。これを超える行を一度に並べると、置いた時点で奈落まで届く */
const FIELD_ROWS = Math.floor(FIELD_H / CELL_H);

/**
 * 調整値ごとの許容範囲。この範囲の中なら、sim は壊れない（行のリングバッファがあふれない、
 * HP が Uint8 に収まる、速さや時間で割っても有限のまま、など）。調整パネルの入力範囲にも使う。
 */
export const TUNING_LIMITS: { readonly [S in keyof Tuning]: { readonly [K in keyof Tuning[S]]: TuningRange } } = {
  paddle: {
    width: { min: 0.2, max: FIELD_W },
    height: { min: 0.02, max: 1 },
    maxBounceDeg: { min: 0, max: 75 },
    dragGain: { min: 0.05, max: 10 },
    launchTiltMaxDeg: { min: 0, max: 75 },
    launchTiltFullSpeed: { min: 0.01, max: 1000 },
  },
  ball: {
    speedStart: { min: 0.1, max: 30 },
    speedMax: { min: 0.1, max: 30 },
    speedRampSeconds: { min: 0, max: 36000 },
    minDegFromHorizontal: { min: 0, max: 60 },
  },
  blocks: {
    ballsFromBall: { min: 0, max: 100, int: true },
    ballsFromHard: { min: 0, max: 100, int: true },
    ballsFromMega: { min: 0, max: 100, int: true },
    spreadDeg: { min: 0, max: 180 },
    megaSpreadDeg: { min: 0, max: 180 },
  },
  endless: {
    initialRows: { min: 1, max: FIELD_ROWS, int: true },
    descentStart: { min: 0, max: 60 },
    descentAccelPerMinute: { min: 0, max: 60 },
    stepDropSeconds: { min: 0, max: 5 },
    penaltyRows: { min: 0, max: FIELD_ROWS, int: true },
    penaltyDropSeconds: { min: 0, max: 5 },
    hardRatioStart: { min: 0, max: 1 },
    hardRatioMax: { min: 0, max: 1 },
    hardRatioRampSeconds: { min: 0, max: 36000 },
    megaRatio: { min: 0, max: 1 },
    bandRowsMin: { min: 1, max: FIELD_ROWS, int: true },
    bandRowsMax: { min: 1, max: FIELD_ROWS, int: true },
    gapRowsMin: { min: 0, max: FIELD_ROWS, int: true },
    gapRowsMax: { min: 0, max: FIELD_ROWS, int: true },
    hardHpStart: { min: 1, max: 255, int: true },
    hardHpScaleSeconds: { min: 0.01, max: 36000 },
    hardHpPower: { min: 0, max: 8 },
    hardHpMax: { min: 1, max: 255, int: true },
    refillRows: { min: 1, max: FIELD_ROWS, int: true },
    refillDropSeconds: { min: 0, max: 5 },
    jackpotIntervalSeconds: { min: 1, max: 36000 },
    jackpotRows: { min: 3, max: FIELD_ROWS, int: true },
  },
  stage: {
    lives: { min: 1, max: 99, int: true },
  },
  score: {
    chainWindow: { min: 0, max: 10 },
    chainDivisor: { min: 0.01, max: 10000 },
    chainMultMax: { min: 1, max: 1000 },
    pointsBall: { min: 0, max: 1e6, int: true },
    pointsHardPerHp: { min: 0, max: 1e6, int: true },
    pointsMega: { min: 0, max: 1e6, int: true },
    pointsOverflow: { min: 0, max: 1e6, int: true },
    pointsClearBall: { min: 0, max: 1e6, int: true },
  },
};

/** 範囲に収める。有限でない値は fallback にする */
function fitRange(v: number, range: TuningRange, fallback: number): number {
  let n = Number.isFinite(v) ? v : fallback;
  if (range.int) n = Math.round(n);
  return n < range.min ? range.min : n > range.max ? range.max : n;
}

function deepFreeze<T extends object>(o: T): T {
  for (const v of Object.values(o)) if (typeof v === 'object' && v !== null) deepFreeze(v);
  return Object.freeze(o);
}

/** 起動時の調整値。範囲外の値を直すときの基準にする */
const TUNING_DEFAULTS: SimConfig = deepFreeze(structuredClone(tuning));

/**
 * 調整値の写しを作り、各値を `TUNING_LIMITS` の範囲に収める。値どうしの前後関係（最小 ≤ 最大）もそろえる。
 * 範囲外の値や数でない値が混ざっていても、返す値は必ず sim が安全に扱える。
 */
export function sanitizeTuning(src: DeepReadonly<Tuning>): SimConfig {
  const out = structuredClone(src) as Tuning;
  const defaults = TUNING_DEFAULTS as Record<string, Record<string, number>>;
  const limits = TUNING_LIMITS as Record<string, Record<string, TuningRange>>;
  const target = out as unknown as Record<string, Record<string, number>>;
  for (const section of Object.keys(limits)) {
    const s = target[section];
    for (const key of Object.keys(limits[section])) {
      s[key] = fitRange(Number(s[key]), limits[section][key], defaults[section][key]);
    }
  }
  const e = out.endless;
  e.bandRowsMax = Math.max(e.bandRowsMin, e.bandRowsMax);
  e.gapRowsMax = Math.max(e.gapRowsMin, e.gapRowsMax);
  return deepFreeze(out);
}

/** いまの調整値の写し（範囲に収めたもの）。プレイを作るときに 1 回だけ取る */
export function snapshotTuning(): SimConfig {
  return sanitizeTuning(tuning);
}
