import { ACTIONS, MAX_HANDS } from '../rules/round.ts';
import type { Action } from '../rules/round.ts';
import type { HudState } from '../types.ts';
import { BET_CONTROLS, HudModel, noBetControls } from './model.ts';
import type { BetControl, BetLabelFrame, HudFrame, LabelFrame } from './model.ts';

/** HUD の書き込み先。DOM への書き込みは実装側（dom.ts）が持つ */
export interface HudTarget {
  /** 手持ちのチップと、動いている間の跳ね、自己ベストを超えたか */
  chips(text: string, bump: number, newBest: boolean): void;
  /** 連勝（空なら出さない）と、次の倍率、フィーバーの強さ */
  streak(count: string, multiplier: string, fever: number): void;
  /** 今のラウンドと、最後のラウンドか */
  round(text: string, final: boolean): void;
  /** 下端に賭けのボタンを出すか（出さなければ操作のボタン） */
  betting(on: boolean): void;
  /** 賭けのボタンを押せるか */
  bet(control: BetControl, enabled: boolean): void;
  /** 操作のボタンを押せるか */
  action(action: Action, enabled: boolean): void;
  /** 合計の札。index は 0 がディーラー、1〜 がプレイヤーの手 */
  label(index: number, l: LabelFrame): void;
  /** 賭けの額の札。index はプレイヤーの手 */
  betLabel(index: number, b: BetLabelFrame): void;
}

const copyLabel = (to: LabelFrame, from: LabelFrame): void => {
  to.shown = from.shown;
  to.text = from.text;
  to.state = from.state;
  to.x = from.x;
  to.y = from.y;
};

const sameLabel = (a: LabelFrame, b: LabelFrame): boolean => a.shown === b.shown && (!a.shown || (a.text === b.text && a.state === b.state && a.x === b.x && a.y === b.y));

const copyBet = (to: BetLabelFrame, from: BetLabelFrame): void => {
  to.shown = from.shown;
  to.text = from.text;
  to.crowded = from.crowded;
  to.allIn = from.allIn;
  to.x = from.x;
  to.y = from.y;
  to.width = from.width;
};

const sameBet = (a: BetLabelFrame, b: BetLabelFrame): boolean =>
  a.shown === b.shown && (!a.shown || (a.text === b.text && a.crowded === b.crowded && a.allIn === b.allIn && a.x === b.x && a.y === b.y && a.width === b.width));

const blankLabel = (): LabelFrame => ({ shown: false, text: '', state: 'waiting', x: 0, y: 0 });
const blankBet = (): BetLabelFrame => ({ shown: false, text: '', crowded: false, allIn: false, x: 0, y: 0, width: 0 });

/**
 * HudFrame のうち、前回から変わった値だけを書き込み先へ渡す。
 * 作った直後は何も書いていない扱いなので、最初の write ですべてを書く。
 * 渡された HudFrame は使い回されるので、前回の値は自分の入れ物に写して持つ。
 */
class HudWriter {
  private readonly target: HudTarget;
  private readonly last = {
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
    actions: { hit: false, stand: false, double: false, split: false } as Record<Action, boolean>,
    labels: Array.from({ length: MAX_HANDS + 1 }, blankLabel),
    bets: Array.from({ length: MAX_HANDS }, blankBet),
  };
  private written = false;

  constructor(target: HudTarget) {
    this.target = target;
  }

  write(f: HudFrame): void {
    const p = this.last;
    const t = this.target;
    const all = !this.written;
    if (all || p.chips !== f.chips || p.chipsBump !== f.chipsBump || p.newBest !== f.newBest) t.chips(f.chips, f.chipsBump, f.newBest);
    if (all || p.streak !== f.streak || p.multiplier !== f.multiplier || p.fever !== f.fever) t.streak(f.streak, f.multiplier, f.fever);
    if (all || p.round !== f.round || p.finalRound !== f.finalRound) t.round(f.round, f.finalRound);
    if (all || p.betting !== f.betting) t.betting(f.betting);
    for (const c of BET_CONTROLS) if (all || p.bet[c] !== f.bet[c]) t.bet(c, f.bet[c]);
    for (const a of ACTIONS) if (all || p.actions[a] !== f.actions[a]) t.action(a, f.actions[a]);
    for (let i = 0; i <= MAX_HANDS; i++) {
      const l = i === 0 ? f.dealer : f.hands[i - 1];
      if (all || !sameLabel(p.labels[i], l)) t.label(i, l);
      copyLabel(p.labels[i], l);
    }
    for (let i = 0; i < MAX_HANDS; i++) {
      const b = f.bets[i];
      if (all || !sameBet(p.bets[i], b)) t.betLabel(i, b);
      copyBet(p.bets[i], b);
    }
    p.chips = f.chips;
    p.chipsBump = f.chipsBump;
    p.newBest = f.newBest;
    p.streak = f.streak;
    p.multiplier = f.multiplier;
    p.fever = f.fever;
    p.round = f.round;
    p.finalRound = f.finalRound;
    p.betting = f.betting;
    for (const c of BET_CONTROLS) p.bet[c] = f.bet[c];
    for (const a of ACTIONS) p.actions[a] = f.actions[a];
    this.written = true;
  }
}

/**
 * ゲームから毎フレーム届く HudState を HUD に映す。
 * runId が変わったら、表示の状態（HudModel）も書き込みの記憶（HudWriter）も作り直すので、前のプレイの表示は必ず書き換わる。
 */
export class HudPresenter {
  private readonly target: HudTarget;
  private run: { id: number; model: HudModel; writer: HudWriter; lastTime: number } | null = null;

  constructor(target: HudTarget) {
    this.target = target;
  }

  /** now: 実時間（秒） */
  push(s: HudState, now: number): void {
    let run = this.run;
    let dt: number | null = null;
    if (!run || run.id !== s.runId) {
      run = { id: s.runId, model: new HudModel(s), writer: new HudWriter(this.target), lastTime: now };
      this.run = run;
    } else {
      dt = now - run.lastTime;
      run.lastTime = now;
    }
    run.writer.write(run.model.update(s, dt));
  }
}
