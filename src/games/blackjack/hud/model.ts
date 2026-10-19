import { formatScore } from '../../../shared/format.ts';
import { clamp } from '../../../shared/math.ts';
import { BET_CHIPS } from '../denominations.ts';
import type { BetChip } from '../denominations.ts';
import { ACTIONS, MAX_HANDS } from '../rules/round.ts';
import type { Action } from '../rules/round.ts';
import { MIN_BET, ROUNDS } from '../scoring.ts';
import type { BetLabel, HandLabel, HudState, LabelState } from '../types.ts';

/** 合計の札 1 つの、書く値 */
export type LabelFrame = {
  shown: boolean;
  /** 合計（ソフトで 21 未満なら「7 or 17」のように、A を 1 と数えた合計も添える） */
  text: string;
  state: LabelState;
  /** CSS ピクセル（小数 1 桁で丸めてある） */
  x: number;
  y: number;
};

/** 賭けの額の札 1 つの、書く値 */
export type BetLabelFrame = {
  shown: boolean;
  /** 賭けの額（3 桁ごとに区切る） */
  text: string;
  /** 札を並べる幅が狭い */
  crowded: boolean;
  /** 賭けを選んでいる間に、賭けが上限（手持ちすべて）に届いた（ALL IN と添える） */
  allIn: boolean;
  /** CSS ピクセル（小数 1 桁で丸めてある）。width は札に使える幅 */
  x: number;
  y: number;
  width: number;
};

/** 賭けのボタン: 置けるチップと、すべて賭ける・取り消す・配る */
export type BetControl = BetChip | 'allIn' | 'clear' | 'deal';
export const BET_CONTROLS: readonly BetControl[] = [...BET_CHIPS, 'allIn', 'clear', 'deal'];

/** HUD に書く値。文字列と、CSS に渡す数値（小数 3 桁で丸めてある） */
export type HudFrame = {
  /** 手持ちのチップ（3 桁ごとに区切る）。実際の値へ転がるように動く */
  chips: string;
  /** 手持ちが動いている間の跳ね（0〜1）。増えるときは正、減るときは負 */
  chipsBump: number;
  newBest: boolean;
  /** 連勝（2 未満は空）と、次に勝ったラウンドの倍率（×1.5 など）、フィーバーの強さ */
  streak: string;
  multiplier: string;
  fever: number;
  /** 今のラウンド（「3/10」）と、最後のラウンドか */
  round: string;
  finalRound: boolean;
  /** 賭けを選んでいる（下端に賭けのボタンを出す。そうでなければ操作のボタン） */
  betting: boolean;
  bet: Record<BetControl, boolean>;
  actions: Record<Action, boolean>;
  dealer: LabelFrame;
  hands: LabelFrame[];
  bets: BetLabelFrame[];
};

const BUMP_DECAY = 9;
const BUMP_EPSILON = 1e-3;
/** 手持ちが実際の値へ寄っていく速さ（1/秒） */
const CHIPS_RATE = 9;
const FIRST_DT = 1 / 60;
const MAX_DT = 0.1;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

const emptyLabel = (): LabelFrame => ({ shown: false, text: '', state: 'waiting', x: 0, y: 0 });
const emptyBetLabel = (): BetLabelFrame => ({ shown: false, text: '', crowded: false, allIn: false, x: 0, y: 0, width: 0 });
export const noBetControls = (): Record<BetControl, boolean> => ({ 10: false, 100: false, 500: false, 1000: false, allIn: false, clear: false, deal: false });

/** 合計の札の文字 */
export function totalText(total: number, soft: boolean): string {
  return soft && total < 21 ? `${total - 10} or ${total}` : String(total);
}

/**
 * 1 回のプレイぶんの HUD の表示を決める。DOM には触らない。手持ちは実際の値へ転がるように動かし、動いている間は跳ねさせる。
 * 別のプレイの表示には使わない（プレイごとに作り直す）。
 * 毎フレーム呼ぶので、返す HudFrame は使い回し、文字列は値が変わったときだけ作る。
 */
export class HudModel {
  private readonly frame: HudFrame = {
    chips: '',
    chipsBump: 0,
    newBest: false,
    streak: '',
    multiplier: '',
    fever: 0,
    round: '',
    finalRound: false,
    betting: false,
    bet: noBetControls(),
    actions: { hit: false, stand: false, double: false, split: false },
    dealer: emptyLabel(),
    hands: Array.from({ length: MAX_HANDS }, emptyLabel),
    bets: Array.from({ length: MAX_HANDS }, emptyBetLabel),
  };
  private chips: number;
  private chipsBump = 0;
  private shownChips = -1;
  private shownStreak = -1;
  private shownTenths = -1;
  private shownRound = -1;
  /** 札ごとの、文字を作った元の値（-1 はまだ作っていない） */
  private readonly labelTotal = new Int32Array(MAX_HANDS + 1).fill(-1);
  private readonly labelSoft = new Uint8Array(MAX_HANDS + 1);
  private readonly betAmount = new Float64Array(MAX_HANDS).fill(-1);

  /** initial はこのプレイで最初に届いた値。その値から表示を始める */
  constructor(initial: HudState) {
    this.chips = initial.chips;
  }

  /** dt: 前回の呼び出しからの実時間（秒）。最初のフレームは null。返す値は、次に update を呼ぶまで有効 */
  update(s: HudState, dt: number | null): HudFrame {
    const step = dt === null ? FIRST_DT : clamp(dt, 0, MAX_DT);
    const f = this.frame;
    if (s.chips !== this.chips) {
      const dir = s.chips > this.chips ? 1 : -1;
      const next = this.chips + (s.chips - this.chips) * (1 - Math.exp(-step * CHIPS_RATE));
      this.chips = dir > 0 ? Math.min(s.chips, Math.max(this.chips + 1, next)) : Math.max(s.chips, Math.min(this.chips - 1, next));
      this.chipsBump = dir;
    } else {
      const decay = Math.exp(-step * BUMP_DECAY);
      this.chipsBump *= decay;
      if (Math.abs(this.chipsBump) < BUMP_EPSILON) this.chipsBump = 0;
    }
    const chips = Math.round(this.chips);
    if (chips !== this.shownChips) {
      this.shownChips = chips;
      f.chips = formatScore(chips);
    }
    f.chipsBump = round3(this.chipsBump);
    f.newBest = s.newBest;
    if (s.streak !== this.shownStreak) {
      this.shownStreak = s.streak;
      f.streak = s.streak >= 2 ? String(s.streak) : '';
    }
    if (s.nextMultiplierTenths !== this.shownTenths) {
      this.shownTenths = s.nextMultiplierTenths;
      f.multiplier = `×${(s.nextMultiplierTenths / 10).toFixed(1)}`;
    }
    f.fever = round3(s.fever);
    if (s.round !== this.shownRound) {
      this.shownRound = s.round;
      f.round = `${s.round}/${ROUNDS}`;
    }
    f.finalRound = s.finalRound;
    const slip = s.slip;
    f.betting = slip.open;
    for (const c of BET_CHIPS) f.bet[c] = slip.open && slip.bet < slip.limit;
    f.bet.allIn = slip.open && slip.bet < slip.limit;
    f.bet.clear = slip.open && slip.bet > 0;
    f.bet.deal = slip.open && slip.bet >= MIN_BET;
    for (const a of ACTIONS) f.actions[a] = s.actions[a];
    this.label(0, s.dealer, f.dealer);
    for (let i = 0; i < MAX_HANDS; i++) {
      this.label(i + 1, s.hands[i], f.hands[i]);
      this.betLabel(i, s.bets[i], f.bets[i]);
    }
    f.bets[0].allIn = slip.open && slip.bet > 0 && slip.bet >= slip.limit;
    return f;
  }

  /** 合計の札を書く。文字は値が変わったときだけ作る */
  private label(key: number, l: HandLabel, out: LabelFrame): void {
    out.shown = l.shown;
    if (!l.shown) return;
    const soft = l.soft ? 1 : 0;
    if (this.labelTotal[key] !== l.total || this.labelSoft[key] !== soft) {
      this.labelTotal[key] = l.total;
      this.labelSoft[key] = soft;
      out.text = totalText(l.total, l.soft);
    }
    out.state = l.state;
    out.x = round1(l.x);
    out.y = round1(l.y);
  }

  /** 賭けの額の札を書く。文字は額が変わったときだけ作る */
  private betLabel(i: number, b: BetLabel, out: BetLabelFrame): void {
    out.shown = b.shown;
    if (!b.shown) return;
    if (this.betAmount[i] !== b.amount) {
      this.betAmount[i] = b.amount;
      out.text = formatScore(b.amount);
    }
    out.crowded = b.crowded;
    out.x = round1(b.x);
    out.y = round1(b.y);
    out.width = round1(b.width);
  }
}
