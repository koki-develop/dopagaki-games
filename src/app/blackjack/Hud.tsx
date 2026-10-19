import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import { isInteractiveTarget } from '../../engine/input.ts';
import { BET_CHIPS, denominationOf } from '../../games/blackjack/denominations.ts';
import type { BetChip } from '../../games/blackjack/denominations.ts';
import { createHudDomTarget } from '../../games/blackjack/hud/dom.ts';
import type { LabelElements } from '../../games/blackjack/hud/dom.ts';
import { computeHudLayout, sameHudLayout } from '../../games/blackjack/hud/layout.ts';
import type { BetControl } from '../../games/blackjack/hud/model.ts';
import { HudPresenter } from '../../games/blackjack/hud/writer.ts';
import { ACTIONS, MAX_HANDS } from '../../games/blackjack/rules/round.ts';
import type { Action } from '../../games/blackjack/rules/round.ts';
import type { HudState, SessionHandle } from '../../games/blackjack/types.ts';
import { chipLabel, paintChipFace } from '../../games/blackjack/view/chip-art.ts';
import { formatScore } from '../../shared/format.ts';
import type { LatestFeed } from '../../shared/feed.ts';
import { boxOf, observeLayout } from '../game/observeLayout.ts';

type Props = {
  feed: LatestFeed<HudState>;
  session: SessionHandle | null;
  visible: boolean;
  /** 一時停止ボタンと、賭けと操作のボタン・キーを使える（プレイ中） */
  canPlay: boolean;
  onPause: () => void;
};

/** 操作のボタンの文字と、対応するキー */
const ACTION_UI: Readonly<Record<Action, { label: string; key: string; name: string }>> = {
  hit: { label: 'HIT', key: 'H', name: '引く' },
  stand: { label: 'STAND', key: 'S', name: '止める' },
  double: { label: 'DOUBLE', key: 'D', name: 'ダブル' },
  split: { label: 'SPLIT', key: 'P', name: '分ける' },
};

/** 操作のボタンの並び: 上の段にダブルと分ける、親指の届く下の段に引くと止める */
const ACTION_ROWS: readonly (readonly Action[])[] = [
  ['double', 'split'],
  ['hit', 'stand'],
];

/** 賭けのチップのボタンのキー（1〜4）と、すべて賭ける・取り消す・配るのキー */
const CHIP_KEYS: readonly string[] = BET_CHIPS.map((_, i) => String(i + 1));
const ALL_IN_KEY = 'A';
const CLEAR_KEY = 'C';
const DEAL_KEY = 'Enter';

const KEY_ACTIONS: ReadonlyMap<string, Action> = new Map(ACTIONS.map((a) => [ACTION_UI[a].key.toLowerCase(), a]));

/** 合計の札の数（ディーラーと、プレイヤーの手） */
const LABELS = MAX_HANDS + 1;

/** 賭けのチップのボタンの絵の一辺（CSS ピクセル） */
const CHIP_BUTTON_PX = 48;

/** チップのボタンの絵。卓のチップと同じ絵（chip-art.ts）を、画面の画素密度に合わせて描く */
function ChipFace({ value }: { value: BetChip }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const size = Math.round(CHIP_BUTTON_PX * dpr);
    canvas.width = size;
    canvas.height = size;
    paintChipFace(ctx, denominationOf(value), size / 2, size / 2, size / 2 - 1);
  }, [value]);
  return <canvas ref={ref} className="bj-chip-face" aria-hidden="true" />;
}

/**
 * プレイ中の HUD。上端に手持ちのチップ・連勝と次の倍率・ラウンド・一時停止ボタン、卓の上に手ごとの合計の札と賭けの額の札、
 * 下端に、賭けを選んでいる間は賭けのボタン（チップを置く・取り消す・配る）、ラウンドの間は操作のボタンを置く。
 *
 * - 中身の数字と、ボタンを押せるか、どちらのボタンを出すかは、React を通さず HudPresenter が毎フレーム DOM へ直接書く
 * - 下端の 2 組のボタンは同じ大きさの枠に重ねて置き、切り替えても卓の大きさを変えない。隠した組は inert にする
 * - ボタンは押した瞬間（pointerdown）に送る。キーボードで押したとき（click の detail が 0）も送る。
 *   キーは、操作が H・S・D・P、チップが 1〜4、取り消すが C、配るが Enter
 * - 上端の HUD の下端と、下端のボタンの上端を測ってゲームへ伝える。卓はその間に収まる
 */
export default function Hud({ feed, session, visible, canPlay, onPause }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLSpanElement>(null);
  const chipsWrapRef = useRef<HTMLDivElement>(null);
  const streakRef = useRef<HTMLDivElement>(null);
  const streakCountRef = useRef<HTMLSpanElement>(null);
  const streakMultRef = useRef<HTMLSpanElement>(null);
  const roundRef = useRef<HTMLDivElement>(null);
  const roundValueRef = useRef<HTMLSpanElement>(null);
  const betPanelRef = useRef<HTMLDivElement>(null);
  const actionPanelRef = useRef<HTMLDivElement>(null);
  const actionRefs = useRef<Partial<Record<Action, HTMLButtonElement>>>({});
  const betRefs = useRef<Partial<Record<BetControl, HTMLButtonElement>>>({});
  const labelRefs = useRef<(LabelElements | null)[]>(new Array(LABELS).fill(null));
  const betLabelRefs = useRef<(HTMLElement | null)[]>(new Array(MAX_HANDS).fill(null));

  // 毎フレームの数字の書き込み
  useEffect(() => {
    const chips = chipsRef.current;
    const chipsWrap = chipsWrapRef.current;
    const streak = streakRef.current;
    const streakCount = streakCountRef.current;
    const streakMultiplier = streakMultRef.current;
    const round = roundRef.current;
    const roundValue = roundValueRef.current;
    const controls = bottomRef.current;
    const betPanel = betPanelRef.current;
    const actionPanel = actionPanelRef.current;
    const a = actionRefs.current;
    const b = betRefs.current;
    const labels = labelRefs.current;
    const betLabels = betLabelRefs.current;
    if (!chips || !chipsWrap || !streak || !streakCount || !streakMultiplier || !round || !roundValue || !controls || !betPanel || !actionPanel) return;
    if (!a.hit || !a.stand || !a.double || !a.split) return;
    if (!b[10] || !b[100] || !b[500] || !b[1000] || !b.allIn || !b.clear || !b.deal) return;
    if (labels.some((l) => l === null) || betLabels.some((l) => l === null)) return;
    const presenter = new HudPresenter(
      createHudDomTarget({
        chips,
        chipsWrap,
        streak,
        streakCount,
        streakMultiplier,
        round,
        roundValue,
        controls,
        betPanel,
        actionPanel,
        bets: { 10: b[10], 100: b[100], 500: b[500], 1000: b[1000], allIn: b.allIn, clear: b.clear, deal: b.deal },
        actions: { hit: a.hit, stand: a.stand, double: a.double, split: a.split },
        labels: labels as LabelElements[],
        betLabels: betLabels as HTMLElement[],
      }),
    );
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

  // キー。押しっぱなしの繰り返しと、ほかの入力欄やダイアログに届いたキーは扱わない
  useEffect(() => {
    if (!session || !canPlay) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      // ボタンにフォーカスがあるときの Enter は、そのボタンの click（detail 0）が送る
      if (isInteractiveTarget(target) && !(target instanceof HTMLButtonElement && (target.dataset.action || target.dataset.bet))) return;
      if (e.key === DEAL_KEY) {
        if (target instanceof HTMLButtonElement) return;
        e.preventDefault();
        session.deal();
        return;
      }
      const key = e.key.toLowerCase();
      const chip = CHIP_KEYS.indexOf(key);
      if (chip >= 0) {
        e.preventDefault();
        session.placeChip(BET_CHIPS[chip]);
        return;
      }
      if (key === ALL_IN_KEY.toLowerCase()) {
        e.preventDefault();
        session.allIn();
        return;
      }
      if (key === CLEAR_KEY.toLowerCase()) {
        e.preventDefault();
        session.clearBet();
        return;
      }
      const action = KEY_ACTIONS.get(key);
      if (!action) return;
      e.preventDefault();
      session.act(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, canPlay]);

  const sendBet = (control: BetControl) => {
    if (!session) return;
    if (control === 'allIn') session.allIn();
    else if (control === 'clear') session.clearBet();
    else if (control === 'deal') session.deal();
    else session.placeChip(control);
  };
  // 指とマウスは押した瞬間に送る。キーボードで押した（Enter・Space）ときだけ click で送る
  const pressAction = (action: Action) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button === 0 && canPlay) session?.act(action);
  };
  const clickAction = (action: Action) => (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0 && canPlay) session?.act(action);
  };
  const pressBet = (control: BetControl) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button === 0 && canPlay) sendBet(control);
  };
  const clickBet = (control: BetControl) => (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0 && canPlay) sendBet(control);
  };
  const betRef = (control: BetControl) => (el: HTMLButtonElement | null) => {
    if (el) betRefs.current[control] = el;
    else delete betRefs.current[control];
  };

  return (
    <>
      <div ref={rootRef} className="bj-hud hud-layer" data-visible={visible}>
        <div ref={chipsWrapRef} className="bj-chips">
          <span className="bj-chips-label">CHIPS</span>
          <span ref={chipsRef} className="bj-chips-value" />
          <span className="bj-chips-best">BEST</span>
        </div>
        <div ref={streakRef} className="bj-streak" data-on="false" aria-hidden="true">
          <span className="bj-streak-label">STREAK</span>
          <span ref={streakCountRef} className="bj-streak-count" />
          <span ref={streakMultRef} className="bj-streak-mult" />
        </div>
        <div ref={roundRef} className="bj-round" data-final="false" aria-hidden="true">
          <span className="bj-round-label">ROUND</span>
          <span ref={roundValueRef} className="bj-round-value" />
        </div>
        <button type="button" className="icon-btn bj-pause" aria-label="一時停止" aria-disabled={!canPlay} onClick={onPause}>
          <span className="pause-icon" />
        </button>
      </div>

      <div className="bj-labels hud-layer" data-visible={visible} aria-hidden="true">
        {Array.from({ length: LABELS }, (_, i) => (
          <div
            key={`total-${i}`}
            className="bj-label"
            data-side={i === 0 ? 'dealer' : 'player'}
            hidden
            ref={(root) => {
              const total = root?.querySelector<HTMLElement>('.bj-label-total');
              labelRefs.current[i] = root && total ? { root, total } : null;
            }}
          >
            <span className="bj-label-total" />
            <span className="bj-label-tag" />
          </div>
        ))}
        {Array.from({ length: MAX_HANDS }, (_, i) => (
          <div
            key={`bet-${i}`}
            className="bj-bet-label"
            hidden
            ref={(el) => {
              betLabelRefs.current[i] = el;
            }}
          />
        ))}
      </div>

      <div ref={bottomRef} className="bj-controls hud-layer" data-visible={visible} data-phase="play">
        <div ref={betPanelRef} className="bj-panel bj-betbar" inert>
          <div className="bj-chip-row">
            {BET_CHIPS.map((value, i) => (
              <button
                key={value}
                type="button"
                className="bj-chip-btn"
                data-bet={value}
                aria-disabled="true"
                aria-label={`${formatScore(value)} を賭けに足す（${CHIP_KEYS[i]}）`}
                ref={betRef(value)}
                onPointerDown={pressBet(value)}
                onClick={clickBet(value)}
              >
                <ChipFace value={value} />
                <span className="bj-key" aria-hidden="true">
                  {CHIP_KEYS[i]}
                </span>
                <span className="visually-hidden">{chipLabel(value)}</span>
              </button>
            ))}
            <button
              type="button"
              className="bj-chip-btn"
              data-bet="allIn"
              aria-disabled="true"
              aria-label={`手持ちをすべて賭ける（${ALL_IN_KEY}）`}
              ref={betRef('allIn')}
              onPointerDown={pressBet('allIn')}
              onClick={clickBet('allIn')}
            >
              <span className="bj-allin-face" aria-hidden="true">
                ALL
                <br />
                IN
              </span>
              <span className="bj-key" aria-hidden="true">
                {ALL_IN_KEY}
              </span>
            </button>
          </div>
          <div className="bj-bet-row">
            <button
              type="button"
              className="bj-btn"
              data-bet="clear"
              data-variant="sub"
              aria-disabled="true"
              aria-label={`賭けを取り消す（${CLEAR_KEY}）`}
              ref={betRef('clear')}
              onPointerDown={pressBet('clear')}
              onClick={clickBet('clear')}
            >
              <span className="bj-btn-label">CLEAR</span>
              <span className="bj-key" aria-hidden="true">
                {CLEAR_KEY}
              </span>
            </button>
            <button
              type="button"
              className="bj-btn"
              data-bet="deal"
              data-variant="main"
              aria-disabled="true"
              aria-label={`この賭けで配る（${DEAL_KEY}）`}
              ref={betRef('deal')}
              onPointerDown={pressBet('deal')}
              onClick={clickBet('deal')}
            >
              <span className="bj-btn-label">DEAL</span>
              <span className="bj-key" aria-hidden="true">
                {DEAL_KEY}
              </span>
            </button>
          </div>
        </div>
        <div ref={actionPanelRef} className="bj-panel bj-actions">
          {ACTION_ROWS.map((row) => (
            <div key={row.join()} className="bj-action-row" data-row={row[0] === 'hit' ? 'main' : 'sub'}>
              {row.map((a) => (
                <button
                  key={a}
                  type="button"
                  className="bj-btn"
                  data-action={a}
                  data-variant={a === 'hit' || a === 'stand' ? 'main' : 'sub'}
                  aria-disabled="true"
                  aria-label={`${ACTION_UI[a].name}（${ACTION_UI[a].key}）`}
                  ref={(el) => {
                    if (el) actionRefs.current[a] = el;
                    else delete actionRefs.current[a];
                  }}
                  onPointerDown={pressAction(a)}
                  onClick={clickAction(a)}
                >
                  <span className="bj-btn-label">{ACTION_UI[a].label}</span>
                  <span className="bj-key" aria-hidden="true">
                    {ACTION_UI[a].key}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
