import type { HudState } from '../types.ts';

/**
 * ゲームから届く HudState を、HUD の表示係へ渡す中継。
 * ゲームは HUD より先にできあがることがあるので、最後の値を覚えておき、つないだ時点で渡す。
 */
export class HudFeed {
  private latest: HudState | null = null;
  private listener: ((s: HudState) => void) | null = null;

  push = (s: HudState): void => {
    this.latest = s;
    this.listener?.(s);
  };

  connect(listener: (s: HudState) => void): () => void {
    this.listener = listener;
    if (this.latest) listener(this.latest);
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }
}
