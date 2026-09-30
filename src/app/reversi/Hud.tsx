import { useEffect, useRef } from 'react';
import { createHudDomTarget } from '../../games/reversi/hud/dom.ts';
import { computeHudLayout, sameHudLayout } from '../../games/reversi/hud/layout.ts';
import { HudPresenter } from '../../games/reversi/hud/writer.ts';
import { BLACK, opponentOf } from '../../games/reversi/rules/position.ts';
import type { Color } from '../../games/reversi/rules/position.ts';
import type { HudState, SessionHandle } from '../../games/reversi/types.ts';
import type { LatestFeed } from '../../shared/feed.ts';
import { boxOf, observeLayout } from '../game/observeLayout.ts';

type Props = {
  feed: LatestFeed<HudState>;
  session: SessionHandle | null;
  visible: boolean;
  /** 人の色（対局の前はタイトルで選んでいる色） */
  human: Color;
  /** 一時停止ボタンを押せる（対局中） */
  canPause: boolean;
  onPause: () => void;
};

const colorClass = (c: Color): string => (c === BLACK ? 'black' : 'white');

/**
 * 対局中の HUD。上端に人と CPU の石の数と綱引きのバー、一時停止ボタン、その下に得点とコンボのゲージ（窓の残り）を置く。
 *
 * - 中身の数字は React を通さず、HudPresenter が毎フレーム DOM へ直接書く
 * - 上端の HUD の下端と、下端の表示の上端を測ってゲームへ伝える。盤はその間に収まる。測り直すのは大きさが変わったときだけ
 */
export default function Hud({ feed, session, visible, human, canPause, onPause }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const humanRef = useRef<HTMLSpanElement>(null);
  const cpuRef = useRef<HTMLSpanElement>(null);
  const humanWrapRef = useRef<HTMLDivElement>(null);
  const cpuWrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<HTMLSpanElement>(null);
  const scoreWrapRef = useRef<HTMLDivElement>(null);
  const gaugeRef = useRef<HTMLDivElement>(null);

  // 毎フレームの数字の書き込み
  useEffect(() => {
    const humanCount = humanRef.current;
    const cpuCount = cpuRef.current;
    const humanWrap = humanWrapRef.current;
    const cpuWrap = cpuWrapRef.current;
    const bar = barRef.current;
    const score = scoreRef.current;
    const scoreWrap = scoreWrapRef.current;
    const gauge = gaugeRef.current;
    if (!humanCount || !cpuCount || !humanWrap || !cpuWrap || !bar || !score || !scoreWrap || !gauge) return;
    const presenter = new HudPresenter(createHudDomTarget({ human: humanCount, cpu: cpuCount, humanWrap, cpuWrap, bar, score, scoreWrap, gauge }));
    return feed.connect((s) => presenter.push(s, performance.now() / 1000));
  }, [feed]);

  // HUD の配置をゲームへ伝える
  useEffect(() => {
    const root = rootRef.current;
    const bottom = bottomRef.current;
    if (!session || !root || !bottom) return;
    const origin = root.parentElement ?? root;
    return observeLayout(
      [root, bottom],
      () => computeHudLayout(boxOf(origin.getBoundingClientRect()), boxOf(root.getBoundingClientRect()), boxOf(bottom.getBoundingClientRect())),
      sameHudLayout,
      (layout) => session.setHudLayout(layout),
    );
  }, [session]);

  const cpu = opponentOf(human);
  return (
    <>
      <div ref={rootRef} className="rv-hud hud-layer" data-visible={visible}>
        <div ref={humanWrapRef} className="rv-score" data-side="human">
          <span className={`rv-disc rv-disc-${colorClass(human)}`} aria-hidden="true" />
          <span className="rv-score-body">
            <span className="rv-score-label">YOU</span>
            <span ref={humanRef} className="rv-score-count" />
          </span>
        </div>
        <div ref={barRef} className="rv-bar" aria-hidden="true">
          <span className="rv-bar-human" />
          <span className="rv-bar-cpu" />
        </div>
        <div ref={cpuWrapRef} className="rv-score" data-side="cpu">
          <span className="rv-score-body">
            <span className="rv-score-label">CPU</span>
            <span ref={cpuRef} className="rv-score-count" />
          </span>
          <span className={`rv-disc rv-disc-${colorClass(cpu)}`} aria-hidden="true" />
        </div>
        <button type="button" className="icon-btn rv-pause" aria-label="一時停止" aria-disabled={!canPause} onClick={onPause}>
          <span className="pause-icon" />
        </button>
        <div className="rv-hud-row">
          <div ref={scoreWrapRef} className="rv-points">
            <span className="rv-points-label">SCORE</span>
            <span ref={scoreRef} className="rv-points-value" />
            <span className="rv-points-best">BEST</span>
          </div>
          <div ref={gaugeRef} className="rv-gauge" data-open="false" aria-hidden="true">
            <span className="rv-gauge-label">COMBO</span>
            <span className="rv-gauge-track">
              <span className="rv-gauge-fill" />
            </span>
          </div>
        </div>
      </div>

      <div ref={bottomRef} className="rv-bottom" aria-hidden="true" />
    </>
  );
}
