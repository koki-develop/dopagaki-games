import { useEffect, useRef } from 'react';
import { createHudDomTarget } from '../../games/breakout/hud/dom.ts';
import { computeHudLayout, sameHudLayout } from '../../games/breakout/hud/layout.ts';
import type { Box } from '../../games/breakout/hud/layout.ts';
import { HudPresenter } from '../../games/breakout/hud/writer.ts';
import type { HudState, SessionHandle } from '../../games/breakout/types.ts';
import type { LatestFeed } from '../../shared/feed.ts';
import { boxOf, observeLayout } from '../game/observeLayout.ts';

type Props = {
  feed: LatestFeed<HudState>;
  session: SessionHandle | null;
  visible: boolean;
  /** 残機を出す（ステージのとき） */
  showLives: boolean;
  /** 一時停止ボタンを押せる（プレイ中） */
  canPause: boolean;
  onPause: () => void;
};

/**
 * プレイ中の HUD。スコア・ベスト・chain・一時停止ボタンを上端に、ステージの残機を右下に置く。
 *
 * - 中身の数字は React を通さず、HudPresenter が毎フレーム DOM へ直接書く
 * - HUD の下端・フィールドの下に空ける高さ・スコアの中心を測り、ゲームへ伝える。フィールドは HUD の下に収まり、
 *   得点に変わった光はスコアへ吸い込まれる。測り直すのは HUD の大きさが変わったときだけ
 * - 位置は、この HUD と同じ親を覆うゲームの描画領域の左上を原点にする
 */
export default function Hud({ feed, session, visible, showLives, canPause, onPause }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scoreWrapRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<HTMLSpanElement>(null);
  const bestRef = useRef<HTMLSpanElement>(null);
  const newBestRef = useRef<HTMLSpanElement>(null);
  const chainWrapRef = useRef<HTMLDivElement>(null);
  const chainRef = useRef<HTMLSpanElement>(null);
  const livesRef = useRef<HTMLDivElement>(null);
  const livesDotsRef = useRef<HTMLSpanElement>(null);
  const bottomProbeRef = useRef<HTMLSpanElement>(null);

  // 毎フレームの数字の書き込み
  useEffect(() => {
    const [scoreWrap, score, best, chainWrap, chain, lives, livesDots, newBest] = [
      scoreWrapRef.current,
      scoreRef.current,
      bestRef.current,
      chainWrapRef.current,
      chainRef.current,
      livesRef.current,
      livesDotsRef.current,
      newBestRef.current,
    ];
    if (!scoreWrap || !score || !best || !chainWrap || !chain || !lives || !livesDots || !newBest) return;
    const presenter = new HudPresenter(createHudDomTarget({ scoreWrap, score, best, chainWrap, chain, lives, livesDots, newBest }));
    return feed.connect((s) => presenter.push(s, performance.now() / 1000));
  }, [feed]);

  // HUD の配置をゲームへ伝える
  useEffect(() => {
    const root = rootRef.current;
    const scoreWrap = scoreWrapRef.current;
    const probe = bottomProbeRef.current;
    if (!session || !root || !scoreWrap || !probe) return;
    const origin = root.parentElement ?? root;
    const measure = () => {
      const hud = root.getBoundingClientRect();
      // 跳ねの変形に左右されないよう、スコアの枠は変形前の位置（offset*）で測る
      const score: Box = {
        left: hud.left + scoreWrap.offsetLeft,
        top: hud.top + scoreWrap.offsetTop,
        width: scoreWrap.offsetWidth,
        height: scoreWrap.offsetHeight,
      };
      return computeHudLayout(boxOf(origin.getBoundingClientRect()), boxOf(hud), score, probe.offsetHeight);
    };
    return observeLayout([root, probe], measure, sameHudLayout, (layout) => session.setHudLayout(layout));
  }, [session]);

  return (
    <>
      <div ref={rootRef} className="hud hud-layer" data-visible={visible}>
        <div className="hud-score-row">
          <div ref={scoreWrapRef} className="hud-score">
            <span ref={scoreRef} />
          </div>
          <span className="hud-best">
            BEST <span ref={bestRef} />
            <span ref={newBestRef} className="hud-newbest">
              NEW!
            </span>
          </span>
        </div>
        <button type="button" className="icon-btn hud-pause" aria-label="一時停止" aria-disabled={!canPause} onClick={onPause}>
          <span className="pause-icon" />
        </button>
        <div ref={chainWrapRef} className="hud-chain">
          <span ref={chainRef} />
        </div>
        {/* フィールドの下に空ける高さを測るための、見えない要素 */}
        <span ref={bottomProbeRef} className="hud-bottom-probe" aria-hidden="true" />
      </div>

      {/* ステージの残機は、目に入りやすい右下に置く */}
      <div ref={livesRef} className="hud-lives hud-layer" data-visible={visible && showLives} role="img" aria-label="残機">
        <span className="hud-label">LIFE</span>
        <span ref={livesDotsRef} className="hud-lives-dots" />
      </div>
    </>
  );
}
