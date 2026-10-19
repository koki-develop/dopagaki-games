import type { Action } from '../rules/round.ts';
import type { BetControl, BetLabelFrame, LabelFrame } from './model.ts';
import type { HudTarget } from './writer.ts';

/** 合計の札 1 つの要素。位置は left / top、状態は data-state で見せ方を変える */
export type LabelElements = { root: HTMLElement; total: HTMLElement };

type HudElements = {
  /** 手持ちのチップの数と、跳ね（--bump）と自己ベスト（data-best）をかける枠 */
  chips: HTMLElement;
  chipsWrap: HTMLElement;
  /** 連勝の数と倍率。フィーバーの強さを --fever で、連勝があるかを data-on で渡す */
  streak: HTMLElement;
  streakCount: HTMLElement;
  streakMultiplier: HTMLElement;
  /** 今のラウンドの数と、最後のラウンドかを data-final に書く枠 */
  round: HTMLElement;
  roundValue: HTMLElement;
  /** 下端のボタンの枠。賭けを選んでいる間は data-phase を bet にする。隠している組のボタンは inert にする */
  controls: HTMLElement;
  betPanel: HTMLElement;
  actionPanel: HTMLElement;
  /** 賭けのボタンと、操作のボタン */
  bets: Record<BetControl, HTMLElement>;
  actions: Record<Action, HTMLElement>;
  /** 合計の札（0 がディーラー、1〜 がプレイヤーの手） */
  labels: readonly LabelElements[];
  /** 賭けの額の札（プレイヤーの手）。並べる幅が狭いことを data-crowded に、賭けが手持ちすべてに届いたことを data-all-in に書く */
  betLabels: readonly HTMLElement[];
};

/** HUD の DOM へ直接書き込む。React の再描画は通さない */
export function createHudDomTarget(el: HudElements): HudTarget {
  return {
    chips: (text, bump, newBest) => {
      if (el.chips.textContent !== text) {
        el.chips.textContent = text;
        // 桁が増えたら字を小さくして、幅に収める（styles.css の .bj-chips-value）
        el.chips.style.setProperty('--chars', String(text.length));
      }
      el.chipsWrap.style.setProperty('--bump', String(bump));
      el.chipsWrap.dataset.best = newBest ? 'true' : 'false';
    },
    streak: (count, multiplier, fever) => {
      el.streakCount.textContent = count;
      el.streakMultiplier.textContent = multiplier;
      el.streak.dataset.on = count === '' ? 'false' : 'true';
      el.streak.style.setProperty('--fever', String(fever));
    },
    round: (text, final) => {
      el.roundValue.textContent = text;
      el.round.dataset.final = final ? 'true' : 'false';
    },
    betting: (on) => {
      el.controls.dataset.phase = on ? 'bet' : 'play';
      el.betPanel.inert = !on;
      el.actionPanel.inert = on;
    },
    bet: (control, enabled) => {
      el.bets[control].setAttribute('aria-disabled', enabled ? 'false' : 'true');
    },
    action: (action, enabled) => {
      el.actions[action].setAttribute('aria-disabled', enabled ? 'false' : 'true');
    },
    label: (index, l: LabelFrame) => {
      const e = el.labels[index];
      if (!e) return;
      e.root.hidden = !l.shown;
      if (!l.shown) return;
      if (e.total.textContent !== l.text) e.total.textContent = l.text;
      e.root.dataset.state = l.state;
      e.root.style.left = `${l.x}px`;
      e.root.style.top = `${l.y}px`;
    },
    betLabel: (index, b: BetLabelFrame) => {
      const e = el.betLabels[index];
      if (!e) return;
      e.hidden = !b.shown;
      if (!b.shown) return;
      const crowded = b.crowded ? 'true' : 'false';
      const allIn = b.allIn ? 'true' : 'false';
      const width = String(b.width);
      const changed = e.textContent !== b.text || e.dataset.crowded !== crowded || e.dataset.allIn !== allIn || e.dataset.width !== width;
      if (e.textContent !== b.text) e.textContent = b.text;
      e.dataset.crowded = crowded;
      e.dataset.allIn = allIn;
      e.style.left = `${b.x}px`;
      e.style.top = `${b.y}px`;
      // 札がその手に使える幅より広ければ縮めて、隣の手の札と重ねない。測るのは中身か幅が変わったときだけ
      if (changed) {
        e.dataset.width = width;
        e.style.scale = '';
        const natural = e.offsetWidth;
        e.style.scale = natural > b.width && b.width > 0 ? String(b.width / natural) : '';
      }
    },
  };
}
