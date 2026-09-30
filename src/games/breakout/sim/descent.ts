import type { SimConfig } from '../config.ts';

/** 同時に進められる 1 段の降下の数。超えたら最も新しい落下に距離を足す */
const STEP_DROP_SLOTS = 16;
/**
 * 1 ステップでブロック全体を動かす距離の上限。超えた分は次のステップへ持ち越す。
 * 行のリングバッファには、危険ラインからこの距離だけ下までの行が収まる。
 */
export const MAX_FIELD_MOVE_PER_STEP = 4;

/** プレイ時間 activeTime（秒）での降下速度（行 / 秒）。descentStart から 1 分ごとに descentAccelPerMinute ずつ、上限なく上がる */
export function descentRateAt(e: SimConfig['endless'], activeTime: number): number {
  return e.descentStart + (e.descentAccelPerMinute * activeTime) / 60;
}

/** 1 回の落下で、経過した割合 p までに進む距離。加速しながら落ち、着地で急に止まる */
const eased = (distance: number, p: number) => distance * p * p * p;

type DescentResult = {
  /** このステップでブロック全体を下げる距離 */
  delta: number;
  /** 1 段の降下が着地した */
  stepLanded: boolean;
  /** ペナルティの落下が着地した */
  penaltyLanded: boolean;
  /** 全消しの補充の落下が着地した。補充にペナルティが重なったときは penaltyLanded と同時に立つ */
  refillLanded: boolean;
};

/**
 * エンドレスのブロックの落下の予定表。落下は 2 系統ある。
 *
 * - 1 段の降下: 降下速度ぶんの量が 1 溜まるたびに 1 段を stepDropSeconds で落とす。
 *   前の段がまだ落ちている間に次の段が来たら、並行して落とす（それぞれの落下の距離を足し合わせる）。
 *   なので降下速度に上限はない。同じステップで始まる段は 1 つの落下にまとめる。
 * - 大きな落下（ペナルティと全消しの補充）: 一度に 1 つだけ。
 *   - ペナルティは、落ちている途中の段の残りを引き取り、進行中の大きな落下があればその残りにも足して、はじめから落とし直す。
 *   - 補充は、落ちている途中のものをすべて捨てる（補充の直前に格子を並べ直すため）。
 *   - 大きな落下の間は 1 段の降下を始めない。溜まった量はそのまま残し、着地した次のステップで始める。
 */
export class Descent {
  /** 次の 1 段の降下までに溜まった量（1 で 1 段） */
  private progress = 0;

  private readonly slotDistance = new Float64Array(STEP_DROP_SLOTS);
  private readonly slotElapsed = new Float64Array(STEP_DROP_SLOTS);
  private readonly slotApplied = new Float64Array(STEP_DROP_SLOTS);
  /** 進行中の 1 段の降下の数。古い順に 0〜slotCount-1 に並ぶ */
  private slotCount = 0;

  private major = false;
  private majorDistance = 0;
  private majorDuration = 0;
  private majorElapsed = 0;
  private majorApplied = 0;
  private majorPenalty = false;
  private majorRefill = false;

  /** 1 ステップの上限を超えて持ち越している距離 */
  private owed = 0;

  private readonly result: DescentResult = { delta: 0, stepLanded: false, penaltyLanded: false, refillLanded: false };

  /** 全消しの補充の行が落ちてきている最中 */
  get refilling(): boolean {
    return this.major && this.majorRefill;
  }

  /**
   * dt 秒進める。rows は降下速度 × dt（溜まる量）。stepRow は 1 段の距離、stepSeconds は 1 段の落下時間。
   * 返す値は使い回すので、次に呼ぶまでに読む。
   */
  advance(dt: number, rows: number, stepRow: number, stepSeconds: number): DescentResult {
    const out = this.result;
    out.stepLanded = false;
    out.penaltyLanded = false;
    out.refillLanded = false;
    this.progress += rows;
    if (!this.major && this.progress >= 1) {
      const n = Math.floor(this.progress);
      this.progress -= n;
      this.startStepDrop(n * stepRow);
    }

    let delta = 0;
    if (this.major) {
      this.majorElapsed += dt;
      const p = this.majorDuration > 0 ? Math.min(1, this.majorElapsed / this.majorDuration) : 1;
      const applied = eased(this.majorDistance, p);
      delta += applied - this.majorApplied;
      this.majorApplied = applied;
      if (p >= 1) {
        this.major = false;
        if (this.majorPenalty) out.penaltyLanded = true;
        if (this.majorRefill) out.refillLanded = true;
        this.majorPenalty = false;
        this.majorRefill = false;
      }
    }
    let w = 0;
    for (let k = 0; k < this.slotCount; k++) {
      this.slotElapsed[k] += dt;
      const p = stepSeconds > 0 ? Math.min(1, this.slotElapsed[k] / stepSeconds) : 1;
      const applied = eased(this.slotDistance[k], p);
      delta += applied - this.slotApplied[k];
      this.slotApplied[k] = applied;
      if (p >= 1) {
        out.stepLanded = true;
        continue;
      }
      if (w !== k) {
        this.slotDistance[w] = this.slotDistance[k];
        this.slotElapsed[w] = this.slotElapsed[k];
        this.slotApplied[w] = this.slotApplied[k];
      }
      w++;
    }
    this.slotCount = w;

    this.owed += delta;
    const move = this.owed > MAX_FIELD_MOVE_PER_STEP ? MAX_FIELD_MOVE_PER_STEP : this.owed;
    this.owed -= move;
    out.delta = move;
    return out;
  }

  private startStepDrop(distance: number): void {
    if (this.slotCount === STEP_DROP_SLOTS) {
      this.slotDistance[STEP_DROP_SLOTS - 1] += distance;
      return;
    }
    const k = this.slotCount++;
    this.slotDistance[k] = distance;
    this.slotElapsed[k] = 0;
    this.slotApplied[k] = 0;
  }

  /** ボールが 0 個になったペナルティの落下を始める */
  startPenalty(distance: number, seconds: number): void {
    let remaining = this.major ? this.majorDistance - this.majorApplied : 0;
    for (let k = 0; k < this.slotCount; k++) remaining += this.slotDistance[k] - this.slotApplied[k];
    this.slotCount = 0;
    this.startMajor(remaining + distance, seconds);
    this.majorPenalty = true;
  }

  /** 全消しの補充の落下を始める。落ちている途中のものは捨てる */
  startRefill(distance: number, seconds: number): void {
    this.slotCount = 0;
    this.major = false;
    this.owed = 0;
    this.startMajor(distance, seconds);
    this.majorPenalty = false;
    this.majorRefill = true;
  }

  private startMajor(distance: number, seconds: number): void {
    this.major = true;
    this.majorDistance = distance;
    this.majorDuration = seconds;
    this.majorElapsed = 0;
    this.majorApplied = 0;
  }
}
