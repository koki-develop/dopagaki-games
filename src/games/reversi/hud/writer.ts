import type { HudState } from '../types.ts';
import { HudModel } from './model.ts';
import type { HudFrame } from './model.ts';

/** HUD の書き込み先。DOM への書き込みは実装側（dom.ts）が持つ */
export interface HudTarget {
  counts(human: string, cpu: string): void;
  bumps(human: number, cpu: number): void;
  share(value: number): void;
  /** 得点と、増えている間の跳ね、自己ベストを超えたか */
  score(text: string, bump: number, newBest: boolean): void;
  /** コンボのゲージ: 窓の残りの割合と、フィーバーの強さ */
  gauge(window: number, fever: number): void;
}

/**
 * HudFrame のうち、前回から変わった値だけを書き込み先へ渡す。
 * 作った直後は何も書いていない扱いなので、最初の write ですべてを書く。
 * 渡された HudFrame は使い回されるので、前回の値は自分の入れ物に写して持つ。
 */
class HudWriter {
  private readonly target: HudTarget;
  private readonly last: HudFrame = {
    human: '',
    cpu: '',
    humanBump: 0,
    cpuBump: 0,
    share: 0,
    score: '',
    scoreBump: 0,
    newBest: false,
    comboWindow: 0,
    fever: 0,
  };
  private written = false;

  constructor(target: HudTarget) {
    this.target = target;
  }

  write(f: HudFrame): void {
    const p = this.last;
    const t = this.target;
    const all = !this.written;
    if (all || p.human !== f.human || p.cpu !== f.cpu) t.counts(f.human, f.cpu);
    if (all || p.humanBump !== f.humanBump || p.cpuBump !== f.cpuBump) t.bumps(f.humanBump, f.cpuBump);
    if (all || p.share !== f.share) t.share(f.share);
    if (all || p.score !== f.score || p.scoreBump !== f.scoreBump || p.newBest !== f.newBest) t.score(f.score, f.scoreBump, f.newBest);
    if (all || p.comboWindow !== f.comboWindow || p.fever !== f.fever) t.gauge(f.comboWindow, f.fever);
    Object.assign(p, f);
    this.written = true;
  }
}

/**
 * ゲームから毎フレーム届く HudState を HUD に映す。
 * runId が変わったら、表示の状態（HudModel）も書き込みの記憶（HudWriter）も作り直すので、前の局の表示は必ず書き換わる。
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
