import { useEffect, useRef } from 'react';
import { formatScore } from '../../shared/format.ts';
import type { Callout } from '../../games/reversi/types.ts';
import type { EventFeed } from '../../shared/feed.ts';
import { leadOf, verdictText } from './summary.ts';

/** 文字を出しておく時間（ms）。CSS のアニメーションの長さと揃える */
const LIFE_MS = { corner: 1300, pass: 1100, score: 1100, combo: 900 } as const;
/** 得点の文字を、打ったマスの中心からこれだけ上に置く（CSS ピクセル） */
const SCORE_RISE_PX = 44;
/** 返した枚数の数え上げ: 最後の数を見せておく時間と、消えるアニメーションの長さ（ms） */
const COUNT_HOLD_MS = 650;
const COUNT_LEAVE_MS = 450;
/** 数え上げの途中で次の数が届かなくなったら消す（ms）。対局を捨てたときなど */
const COUNT_STALE_MS = 4000;
/** 終局の集計と決着が、儀式の終わりに消えるアニメーションの長さ（ms） */
const CEREMONY_LEAVE_MS = 300;
/** 文字の端を、描画領域の左右の端からこれだけ内側に収める（CSS ピクセル） */
const EDGE_PX = 8;

/**
 * 盤の上の文字へ渡す出来事。ゲームからの文字と、新しい対局の始まり（newRun。前の対局の文字をすべて片付ける）と、
 * 終局の儀式の終わり（ceremonyEnd。集計と決着を消す）
 */
export type CalloutEvent = Callout | { kind: 'newRun' } | { kind: 'ceremonyEnd' };

/** 数え上げ中の 1 手の文字と、置く位置（打ったマスの中心）。timer は、出しておく時間か消えるアニメーションの終わりのタイマー */
type Counter = { el: HTMLElement; count: HTMLElement; timer: number; x: number; y: number };

/** 終局の集計の文字。人と CPU の数 */
type Tally = { el: HTMLElement; human: HTMLElement; cpu: HTMLElement };

/** 要素のアニメーションを最初からやり直す（data 属性を付け直し、スタイルを読み直させる） */
function replay(el: HTMLElement, attr: string): void {
  el.removeAttribute(attr);
  void el.offsetWidth;
  el.setAttribute(attr, '');
}

function span(className: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text;
  return s;
}

/**
 * 盤の上に出す短い文字。ゲームから届くたびに DOM へ直接書き、決まった時間で消す。
 * - 対局中: 返した枚数の数え上げ、得点、置いた石のコンボ、角、パス
 * - 終局の儀式: 集計（盤の上側で人と CPU の石を並べて数え上げ、多い側を大きく見せ、数え終えたら強く跳ねる）、
 *   決着（集計の下に叩きつける）。
 *   どちらも儀式が終わるまで（ceremonyEnd）出しておく
 * 返した枚数と集計は、1 つの文字にまとめて、届くたびに数を書き換えて跳ねさせる。
 * 新しい対局が始まったら（newRun）、前の対局の文字とタイマーをすべて片付ける。
 * 動きを減らす設定ではアニメーションが止まるので、消すのは animationend ではなくタイマーで行う。
 * 同じ内容はスクリーンリーダー向けの読み上げで伝えるので、ここは読み上げない。
 */
export default function Callouts({ feed }: { feed: EventFeed<CalloutEvent> }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const timers = new Set<number>();
    const counters = new Map<number, Counter>();
    let tally: Tally | null = null;
    let verdict: HTMLElement | null = null;
    const later = (ms: number, fn: () => void): number => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
      return id;
    };
    const cancel = (id: number) => {
      window.clearTimeout(id);
      timers.delete(id);
    };
    /** 文字の中心を (x, y) に置く。文字の幅が描画領域からはみ出さないよう、左右は内側へずらす */
    const place = (el: HTMLElement, x: number, y: number) => {
      const width = root.clientWidth;
      const half = el.offsetWidth / 2 + EDGE_PX;
      el.style.left = `${Math.min(width - half, Math.max(half, x))}px`;
      el.style.top = `${y}px`;
    };
    /** 種類 kind の文字を作って置き、life ms で消す */
    const spawn = (kind: keyof typeof LIFE_MS, ...children: (Node | string)[]): HTMLElement => {
      const el = document.createElement('div');
      el.className = 'rv-callout';
      el.dataset.kind = kind;
      el.append(...children);
      root.append(el);
      later(LIFE_MS[kind], () => el.remove());
      return el;
    };

    const clear = () => {
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      counters.clear();
      tally = null;
      verdict = null;
      root.replaceChildren();
    };

    const off = feed.connect((c) => {
      switch (c.kind) {
        case 'newRun':
          clear();
          return;
        case 'ceremonyEnd': {
          for (const el of [tally?.el, verdict]) {
            if (!el) continue;
            el.setAttribute('data-leaving', '');
            later(CEREMONY_LEAVE_MS, () => el.remove());
          }
          tally = null;
          verdict = null;
          return;
        }
        case 'flips': {
          let counter = counters.get(c.move);
          if (!counter) {
            const el = document.createElement('div');
            el.className = 'rv-callout';
            el.dataset.kind = 'flips';
            const count = span('rv-callout-count', '');
            el.append(count, span('rv-callout-sub', 'FLIP'));
            root.append(el);
            counter = { el, count, timer: 0, x: c.x, y: c.y };
            counters.set(c.move, counter);
          }
          const current = counter;
          const { el, count } = current;
          count.textContent = String(c.count);
          el.dataset.level = String(c.level);
          // 消えかけているところへ数が届いたら、消すのをやめて出し直す
          el.removeAttribute('data-leaving');
          place(el, current.x, current.y);
          replay(count, 'data-bump');
          cancel(current.timer);
          const finish = () => {
            el.setAttribute('data-leaving', '');
            current.timer = later(COUNT_LEAVE_MS, () => {
              el.remove();
              if (counters.get(c.move) === current) counters.delete(c.move);
            });
          };
          current.timer = later(c.final ? COUNT_HOLD_MS : COUNT_STALE_MS, finish);
          return;
        }
        case 'tally': {
          if (!tally) {
            const el = document.createElement('div');
            el.className = 'rv-callout';
            el.dataset.kind = 'tally';
            const side = (label: string, who: 'human' | 'cpu'): [HTMLElement, HTMLElement] => {
              const col = document.createElement('div');
              col.className = 'rv-tally-side';
              const count = span('rv-callout-count', '');
              count.dataset.side = who;
              col.append(span('rv-callout-sub', label), count);
              return [col, count];
            };
            const [humanCol, human] = side('YOU', 'human');
            const [cpuCol, cpu] = side('CPU', 'cpu');
            const counts = document.createElement('div');
            counts.className = 'rv-tally-counts';
            counts.append(humanCol, span('rv-tally-dash', '–'), cpuCol);
            el.append(counts);
            root.append(el);
            tally = { el, human, cpu };
          }
          const t = tally;
          // 数え終えたら、確定として両方を強く跳ねさせる（styles.css の .rv-callout[data-kind='tally'][data-final]）
          if (c.final) t.el.setAttribute('data-final', '');
          // 多い側を大きく明るく、少ない側を小さく暗くする。数が増えた側だけ跳ねさせる
          const write = (count: HTMLElement, value: number, other: number) => {
            const text = String(value);
            const changed = count.textContent !== text;
            count.textContent = text;
            count.dataset.lead = leadOf(value, other);
            if (changed || c.final) replay(count, 'data-bump');
          };
          write(t.human, c.human, c.cpu);
          write(t.cpu, c.cpu, c.human);
          return;
        }
        case 'verdict': {
          verdict?.remove();
          const el = document.createElement('div');
          el.className = 'rv-callout';
          el.dataset.kind = 'verdict';
          el.dataset.outcome = c.perfect ? 'perfect' : c.outcome;
          el.textContent = verdictText(c.outcome, c.perfect);
          root.append(el);
          verdict = el;
          return;
        }
        case 'pass': {
          const el = spawn('pass', span('rv-callout-sub', c.who === 'human' ? 'YOU' : 'CPU'), 'PASS');
          el.dataset.who = c.who;
          return;
        }
        case 'combo': {
          const el = spawn('combo', String(c.count), span('rv-callout-sub', 'COMBO'));
          place(el, c.x, c.y);
          return;
        }
        case 'score': {
          const children: Node[] = [];
          if (c.quick) children.push(span('rv-callout-quick', 'QUICK'));
          children.push(span('rv-callout-points', `+${formatScore(c.points)}`));
          if (c.multiplier > 1) children.push(span('rv-callout-sub', `×${c.multiplier.toFixed(1)}`));
          const el = spawn('score', ...children);
          el.dataset.boost = c.multiplier > 1 ? 'true' : 'false';
          place(el, c.x, c.y - SCORE_RISE_PX);
          return;
        }
        case 'corner': {
          const el = spawn('corner', 'CORNER');
          place(el, c.x, c.y);
          return;
        }
      }
    });
    return () => {
      off();
      clear();
    };
  }, [feed]);

  return <div ref={rootRef} className="rv-callouts" aria-hidden="true" />;
}
