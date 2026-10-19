import { useEffect, useRef } from 'react';
import { formatScore, formatSigned } from '../../shared/format.ts';
import type { Callout } from '../../games/blackjack/types.ts';
import type { EventFeed } from '../../shared/feed.ts';
import { verdictText } from './summary.ts';

/** 文字を出しておく時間（ms）。CSS のアニメーションの長さと揃える */
const LIFE_MS = {
  blackjack: 1500,
  dealerBust: 1200,
  payout: 1300,
  loss: 1100,
  push: 900,
  streak: 1300,
  streakBreak: 1000,
  finalRound: 1600,
  reshuffle: 1100,
} as const;
/** 終わりの儀式の決着が、儀式の終わりに消えるアニメーションの長さ（ms） */
const CEREMONY_LEAVE_MS = 300;
/** 文字の端を、描画領域の左右の端からこれだけ内側に収める（CSS ピクセル） */
const EDGE_PX = 8;

/**
 * 卓の上の文字へ渡す出来事。ゲームからの文字と、新しいプレイの始まり（newRun。前のプレイの文字をすべて片付ける）と、
 * 終わりの儀式の終わり（ceremonyEnd。決着を消す）
 */
export type CalloutEvent = Callout | { kind: 'newRun' } | { kind: 'ceremonyEnd' };

function span(className: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text;
  return s;
}

/**
 * 卓の上に出す短い文字。ゲームから届くたびに DOM へ直接書き、決まった時間で消す。
 * - プレイ中: ブラックジャック、ディーラーのバースト、ラウンドの増減（勝ちは段階で大きく、負けは光らせない）、連勝、最後のラウンド、混ぜ直し
 * - 終わりの儀式: 決着。儀式が終わるまで（ceremonyEnd）出しておく
 * どの文字も、幅が描画領域の幅（左右に EDGE_PX を残す）を超えるなら、縮めて収める（文字の長さと画面の幅によらず、はみ出さない）
 * 新しいプレイが始まったら（newRun）、前のプレイの文字とタイマーをすべて片付ける。
 * 動きを減らす設定ではアニメーションが止まるので、消すのは animationend ではなくタイマーで行う。
 * 同じ内容はスクリーンリーダー向けの読み上げで伝えるので、ここは読み上げない。
 */
export default function Callouts({ feed }: { feed: EventFeed<CalloutEvent> }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const timers = new Set<number>();
    let verdict: HTMLElement | null = null;
    const later = (ms: number, fn: () => void): void => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    /**
     * 文字の幅が描画領域の幅（左右に EDGE_PX を残す）を超えるなら、縮めて収める。縮める倍率を返す。
     * 縮めるのは CSS の scale で、アニメーションの transform とは別に掛かる（どちらも要素の中心を基準にする）
     */
    const fit = (el: HTMLElement): number => {
      const avail = root.clientWidth - EDGE_PX * 2;
      const width = el.offsetWidth;
      const scale = width > avail && width > 0 ? avail / width : 1;
      el.style.scale = scale < 1 ? String(scale) : '';
      return scale;
    };
    /** 文字の中心を (x, y) に置く。文字の幅が描画領域からはみ出さないよう、左右は内側へずらす */
    const place = (el: HTMLElement, x: number, y: number) => {
      const width = root.clientWidth;
      const half = (el.offsetWidth * fit(el)) / 2 + EDGE_PX;
      el.style.left = `${Math.min(width - half, Math.max(half, x))}px`;
      el.style.top = `${y}px`;
    };
    /** 種類 kind の文字を作って置き（幅が収まらなければ縮め）、life ms で消す */
    const spawn = (kind: keyof typeof LIFE_MS, ...children: (Node | string)[]): HTMLElement => {
      const el = document.createElement('div');
      el.className = 'bj-callout';
      el.dataset.kind = kind;
      el.append(...children);
      root.append(el);
      fit(el);
      later(LIFE_MS[kind], () => el.remove());
      return el;
    };
    const clear = () => {
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      verdict = null;
      root.replaceChildren();
    };

    const off = feed.connect((c) => {
      switch (c.kind) {
        case 'newRun':
          clear();
          return;
        case 'ceremonyEnd':
          if (verdict) {
            const el = verdict;
            el.setAttribute('data-leaving', '');
            later(CEREMONY_LEAVE_MS, () => el.remove());
          }
          verdict = null;
          return;
        case 'blackjack': {
          const el = spawn('blackjack', 'BLACKJACK');
          place(el, c.x, c.y);
          return;
        }
        case 'dealerBust': {
          const el = spawn('dealerBust', span('bj-callout-sub', 'DEALER'), 'BUST');
          el.dataset.celebrate = c.celebrate ? 'true' : 'false';
          place(el, c.x, c.y);
          return;
        }
        case 'payout': {
          const children: Node[] = [span('bj-callout-points', formatSigned(c.total))];
          if (c.bonus > 0) children.push(span('bj-callout-sub', `×${(c.multiplierTenths / 10).toFixed(1)} BONUS +${formatScore(c.bonus)}`));
          const el = spawn('payout', ...children);
          el.dataset.level = String(c.level);
          place(el, c.x, c.y);
          return;
        }
        case 'loss': {
          const el = spawn('loss', span('bj-callout-points', formatSigned(c.total)));
          place(el, c.x, c.y);
          return;
        }
        case 'push': {
          const el = spawn('push', 'PUSH');
          place(el, c.x, c.y);
          return;
        }
        case 'streak':
          spawn('streak', span('bj-callout-count', String(c.count)), span('bj-callout-sub', `STREAK  NEXT ×${(c.multiplierTenths / 10).toFixed(1)}`));
          return;
        case 'streakBreak':
          spawn('streakBreak', span('bj-callout-sub', `STREAK ${c.count}`), 'BREAK');
          return;
        case 'finalRound':
          spawn('finalRound', 'FINAL ROUND');
          return;
        case 'reshuffle':
          spawn('reshuffle', 'RESHUFFLE');
          return;
        case 'verdict': {
          verdict?.remove();
          const el = document.createElement('div');
          el.className = 'bj-callout';
          el.dataset.kind = 'verdict';
          el.dataset.outcome = c.outcome;
          el.append(span('bj-callout-verdict', verdictText(c.outcome)), span('bj-callout-net', formatSigned(c.net)));
          root.append(el);
          fit(el);
          verdict = el;
          return;
        }
        default: {
          // どの種類も上で扱う（種類を足したのに扱い忘れたら、ここで型が合わなくなる）
          const unhandled: never = c;
          return unhandled;
        }
      }
    });
    return () => {
      off();
      clear();
    };
  }, [feed]);

  return <div ref={rootRef} className="bj-callouts" aria-hidden="true" />;
}
