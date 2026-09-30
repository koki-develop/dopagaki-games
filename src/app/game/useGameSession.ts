import { useEffect, useState } from 'react';

/**
 * ゲーム本体（セッション）の作り方と、できたとき・失敗したときの知らせ先。
 * 画面が useState で 1 回だけ作り、同じオブジェクトを渡し続ける
 */
export type SessionBinding<H> = {
  /** 描画領域 el にゲーム本体を作る。alive() が false になった後は、ゲームからの知らせを捨てる */
  start(el: HTMLElement, alive: () => boolean): Promise<H>;
  /** できたゲーム本体を結びつける。画面を離れるときは null */
  bind(session: H | null): void;
  /** 描画の準備が済んだ */
  loaded(): void;
  /** 作れなかった */
  failed(error: unknown): void;
};

/**
 * 描画領域 stageEl がある間だけ、ゲーム本体を生かしておく。できあがったゲーム本体を返す（作る前と破棄の後は null）。
 * 作っている途中で画面を離れたら、できあがったものをすぐに捨てる。
 */
export function useGameSession<H extends { dispose(): void }>(stageEl: HTMLElement | null, binding: SessionBinding<H>): H | null {
  const [session, setSession] = useState<H | null>(null);

  useEffect(() => {
    if (!stageEl) return;
    let cancelled = false;
    let handle: H | null = null;
    binding.start(stageEl, () => !cancelled).then(
      (s) => {
        if (cancelled) {
          s.dispose();
          return;
        }
        handle = s;
        binding.bind(s);
        setSession(s);
        binding.loaded();
      },
      (e: unknown) => {
        if (!cancelled) binding.failed(e);
      },
    );
    return () => {
      cancelled = true;
      binding.bind(null);
      handle?.dispose();
      setSession(null);
    };
  }, [stageEl, binding]);

  return session;
}
