import type { HudTarget } from './writer.ts';

type HudElements = {
  /** 人と CPU の石の数と、跳ね（--bump）をかける枠 */
  human: HTMLElement;
  cpu: HTMLElement;
  humanWrap: HTMLElement;
  cpuWrap: HTMLElement;
  /** 綱引きのバー。人の側の割合を --share で渡す */
  bar: HTMLElement;
  /** 得点と、跳ね（--bump）と自己ベスト（data-best）をかける枠 */
  score: HTMLElement;
  scoreWrap: HTMLElement;
  /** コンボのゲージ。窓の残りを --window、フィーバーの強さを --fever で渡し、窓が開いているかを data-open に書く */
  gauge: HTMLElement;
};

/** HUD の DOM へ直接書き込む。React の再描画は通さない */
export function createHudDomTarget(el: HudElements): HudTarget {
  return {
    counts: (human, cpu) => {
      el.human.textContent = human;
      el.cpu.textContent = cpu;
    },
    bumps: (human, cpu) => {
      el.humanWrap.style.setProperty('--bump', String(human));
      el.cpuWrap.style.setProperty('--bump', String(cpu));
    },
    share: (v) => el.bar.style.setProperty('--share', String(v)),
    score: (text, bump, newBest) => {
      if (el.score.textContent !== text) el.score.textContent = text;
      el.scoreWrap.style.setProperty('--bump', String(bump));
      el.scoreWrap.dataset.best = newBest ? 'true' : 'false';
    },
    gauge: (window, fever) => {
      el.gauge.style.setProperty('--window', String(window));
      el.gauge.style.setProperty('--fever', String(fever));
      el.gauge.dataset.open = window > 0 ? 'true' : 'false';
    },
  };
}
