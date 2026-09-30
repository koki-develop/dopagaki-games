import type { HudTarget } from './writer.ts';

type HudElements = {
  /** 跳ねと光（--bump / --glow）をかける枠 */
  scoreWrap: HTMLElement;
  score: HTMLElement;
  best: HTMLElement;
  chainWrap: HTMLElement;
  chain: HTMLElement;
  /** 残機の表示全体。読み上げ用の名前を持つ */
  lives: HTMLElement;
  /** 残機のライトを並べる入れ物 */
  livesDots: HTMLElement;
  newBest: HTMLElement;
};

/** HUD の DOM へ直接書き込む。React の再描画は通さない */
export function createHudDomTarget(el: HudElements): HudTarget {
  return {
    score: (text) => {
      el.score.textContent = text;
    },
    bump: (v) => el.scoreWrap.style.setProperty('--bump', String(v)),
    glow: (v) => el.scoreWrap.style.setProperty('--glow', String(v)),
    best: (text) => {
      el.best.textContent = text;
    },
    chain: (text) => {
      el.chainWrap.dataset.active = text ? 'true' : 'false';
      el.chain.textContent = text;
    },
    lives: (on, max) => {
      // 最大数のライトを常に並べ、失った分だけ消灯する。並びの幅は変わらない
      const dots = el.livesDots;
      while (dots.childElementCount < max) dots.append(dots.ownerDocument.createElement('span'));
      while (dots.childElementCount > max) dots.lastElementChild?.remove();
      Array.from(dots.children).forEach((d, i) => {
        if (d instanceof HTMLElement) d.dataset.on = i < on ? 'true' : 'false';
      });
      el.lives.setAttribute('aria-label', `残機 ${on} / ${max}`);
    },
    newBest: (active) => {
      el.newBest.dataset.active = active ? 'true' : 'false';
    },
  };
}
