/**
 * チップの額面。卓のチップの山は、額を大きい額面から順に崩して積む（いちばん下が大きい額面）。
 * 払い戻しは CHIP_UNIT（5）の倍数なので、どの額もこの額面で崩しきれる。
 */
export const CHIP_VALUES = [5, 10, 25, 100, 500, 1000, 5000] as const;

/** 賭けるときに置けるチップ（BET_STEP の倍数の額面だけ） */
export const BET_CHIPS = [10, 100, 500, 1000] as const;
export type BetChip = (typeof BET_CHIPS)[number];

/**
 * 1 つの山に積むチップの枚数の上限。20,000 までの 5 の倍数は、崩すと多くても 17 枚になり、そのまま積める（table.test.ts で確かめる）。
 * それより大きく、崩すと 17 枚を超える額は、大きい額面から 17 枚だけ積む（額は賭けの札と HUD の数で見せる）
 */
export const MAX_STACK = 17;

/** 額面 value の、CHIP_VALUES の中の番号。額面でなければ -1 */
export const denominationOf = (value: number): number => CHIP_VALUES.indexOf(value as (typeof CHIP_VALUES)[number]);

/**
 * 卓に積む、amount の山のチップの番号（CHIP_VALUES の添字）の列を out に書く。大きい額面が先（山のいちばん下）。
 * 大きい額面から崩し、MAX_STACK 枚に届いたらそこで止める（それより大きい額は、山の見た目では額に足りない）。
 * 崩しきれない端数（CHIP_UNIT 未満）は捨てる
 */
export function chipStack(amount: number, out: number[]): number[] {
  out.length = 0;
  let rest = amount;
  for (let d = CHIP_VALUES.length - 1; d >= 0; d--) {
    const v = CHIP_VALUES[d];
    while (rest >= v && out.length < MAX_STACK) {
      out.push(d);
      rest -= v;
    }
  }
  return out;
}

/**
 * 額 amount の山（chipStack で積んだ denoms）の、n 枚目のチップが運ぶ額。どのチップも額面の額を運び、
 * いちばん上のチップだけは山の額の残り（積みきれなかった分を含む）を運ぶ。山の全部のチップの額を足すと amount になる
 */
export function chipShare(denoms: readonly number[], amount: number, n: number): number {
  if (n < denoms.length - 1) return CHIP_VALUES[denoms[n]];
  let rest = amount;
  for (let k = 0; k < denoms.length - 1; k++) rest -= CHIP_VALUES[denoms[k]];
  return rest;
}

/** 手持ちのチップの山の、1 列に積む枚数の上限と、列の数の上限 */
export const RACK_CAP = 10;
export const RACK_COLUMNS = 7;
/** 手持ちを崩すときに、1 つ下の額面へ崩してよいいちばん小さい額面（500）の添字 */
const BREAK_FROM = 4;

/** 額面ごとの枚数 counts を RACK_CAP 枚ずつの列に分けたときの列の数 */
export function rackColumns(counts: ArrayLike<number>): number {
  let n = 0;
  for (let d = 0; d < counts.length; d++) n += Math.ceil(counts[d] / RACK_CAP);
  return n;
}

/**
 * 手持ち amount を、卓の手前に並べる額面ごとの枚数（CHIP_VALUES の添字ごと）にして out に書く。
 * 大きい額面から崩してから、500 以上のチップを 1 つ下の額面へ、列（RACK_CAP 枚ずつ）の数が RACK_COLUMNS を超えない間だけ崩していく
 * （1,000 なら 100 が 10 枚、5,000 なら 500 と 100 の列が並ぶ）。手持ちが増えるほど列が増え、高く積まれて見えるようにするため。
 * 崩さなくても列が足りないほど多い手持ち（5,000 が 10 枚を超えるほど）は、小さい額面の列から出さずに、残りを 7 列に収める（額は HUD の数で見せる）
 */
export function rackStacks(amount: number, out: Int32Array): Int32Array {
  out.fill(0);
  let rest = amount;
  for (let d = CHIP_VALUES.length - 1; d >= 0; d--) {
    const v = CHIP_VALUES[d];
    out[d] = Math.floor(rest / v);
    rest -= out[d] * v;
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let d = CHIP_VALUES.length - 1; d >= BREAK_FROM; d--) {
      const into = CHIP_VALUES[d] / CHIP_VALUES[d - 1];
      while (out[d] > 0) {
        out[d]--;
        out[d - 1] += into;
        if (rackColumns(out) <= RACK_COLUMNS) {
          changed = true;
          continue;
        }
        out[d]++;
        out[d - 1] -= into;
        break;
      }
    }
  }
  for (let d = 0; d < out.length && rackColumns(out) > RACK_COLUMNS; d++) out[d] = 0;
  const top = CHIP_VALUES.length - 1;
  out[top] = Math.min(out[top], RACK_COLUMNS * RACK_CAP);
  return out;
}
