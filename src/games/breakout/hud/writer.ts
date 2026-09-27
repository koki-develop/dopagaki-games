import type { HudState } from '../types.ts';
import { HudModel } from './model.ts';
import type { HudFrame } from './model.ts';

/** HUD の書き込み先。DOM への書き込みは実装側（dom.ts）が持つ */
export interface HudTarget {
  score(text: string): void;
  bump(value: number): void;
  glow(value: number): void;
  best(text: string): void;
  /** 空文字は chain が続いていない */
  chain(text: string): void;
  lives(on: number, max: number): void;
  newBest(active: boolean): void;
}

/**
 * HudFrame のうち、前回から変わった値だけを書き込み先へ渡す。
 * 作った直後は何も書いていない扱いなので、最初の write ですべてを書く。
 */
export class HudWriter {
  private readonly target: HudTarget;
  private last: HudFrame | null = null;

  constructor(target: HudTarget) {
    this.target = target;
  }

  write(f: HudFrame): void {
    const p = this.last;
    const t = this.target;
    if (p?.score !== f.score) t.score(f.score);
    if (p?.bump !== f.bump) t.bump(f.bump);
    if (p?.glow !== f.glow) t.glow(f.glow);
    if (p?.best !== f.best) t.best(f.best);
    if (p?.chain !== f.chain) t.chain(f.chain);
    if (p?.lives !== f.lives || p.maxLives !== f.maxLives) t.lives(f.lives, f.maxLives);
    if (p?.newBest !== f.newBest) t.newBest(f.newBest);
    this.last = f;
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
