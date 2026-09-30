import { isInteractiveTarget } from './input.ts';

/** 要素の上の位置の入力を受ける相手。x, y は要素の左上からの CSS ピクセル */
export type PointerHandlers = {
  /** 指（またはマウスのボタン）を押した */
  onPress(x: number, y: number): void;
  /** 動かした。pressed は押したままか（false はボタンを押していないマウスのホバー） */
  onMove(x: number, y: number, pressed: boolean): void;
  /** 離した。pressedAt は押した時刻（秒、performance.now() / 1000 の時間軸） */
  onRelease(x: number, y: number, pressedAt: number): void;
  /** 押していた指が取り消された（pointercancel）か、ホバーしていたマウスが要素の外へ出た */
  onCancel(): void;
  /** 矢印キーか WASD。dx, dy は -1, 0, 1 で、dy は下向きが正 */
  onKeyMove(dx: number, dy: number): void;
  /** スペースか Enter を離した。pressedAt は押した時刻（秒） */
  onKeyConfirm(pressedAt: number): void;
};

/** ポインターの入力を受ける要素。HTMLElement がこの形を満たす */
type PointerSurface = EventTarget & {
  setPointerCapture?(pointerId: number): void;
  getBoundingClientRect(): { left: number; top: number };
};

type PointerOptions = {
  /** キーボードと blur を受ける相手。省略時は window */
  keyTarget?: EventTarget;
  /** 現在時刻（ms）。省略時は performance.now() */
  now?: () => number;
};

type PointerLike = Event & { pointerId: number; pointerType: string; button: number; clientX: number; clientY: number };
type KeyLike = Event & { key: string; repeat: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean };

/** 動かすキー。小文字にした e.key で引く */
const MOVE_KEYS: ReadonlyMap<string, readonly [number, number]> = new Map([
  ['arrowleft', [-1, 0]],
  ['a', [-1, 0]],
  ['arrowright', [1, 0]],
  ['d', [1, 0]],
  ['arrowup', [0, -1]],
  ['w', [0, -1]],
  ['arrowdown', [0, 1]],
  ['s', [0, 1]],
]);
/** 決めるキー */
const CONFIRM_KEYS: ReadonlySet<string> = new Set([' ', 'enter']);

/**
 * 要素の上の位置を指す入力。盤のマスを選ぶゲームで使う。
 *
 * - 入力を受け付けるのは `setActive(true)` の間だけ。切り替えるたびに、押している指とキーを忘れる
 * - Pointer Events に統一する。最初に触れた指だけを追い、ほかの指は無視する。`pointercancel` は離したものとして扱わない。
 *   マウスは主ボタンで押したときだけ押したものとする
 * - マウスはボタンを押していなくても位置を伝える（ホバー）。要素の外へ出たら onCancel を呼ぶ
 * - 矢印キーと WASD は押すたびに（自動の繰り返しも含めて）1 マスずつ動かす。スペースと Enter は、受け付けている間に押したキーを離したときに決める
 * - ボタン・リンク・入力欄など、キー操作を自分で使う要素（とダイアログの中）に届いたキーは扱わない
 * - 既定の動作（スクロールやボタンの押下）を止めるのは、受け付けている間だけ
 */
export class PointerInput {
  private readonly el: PointerSurface;
  private readonly keyTarget: EventTarget;
  private readonly h: PointerHandlers;
  private readonly now: () => number;
  private activeFlag = false;
  private pointer: number | null = null;
  private pressedAt = 0;
  /** 最後に localize() した位置。イベントのたびに入れ物を作らない */
  private x = 0;
  private y = 0;
  /** 受け付けている間に押した決めるキーと、その時刻（秒） */
  private readonly heldConfirm = new Map<string, number>();

  constructor(el: PointerSurface, handlers: PointerHandlers, opts: PointerOptions = {}) {
    this.el = el;
    this.h = handlers;
    this.keyTarget = opts.keyTarget ?? window;
    this.now = opts.now ?? (() => performance.now());
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    el.addEventListener('pointermove', this.onMoveEvt, { passive: true });
    el.addEventListener('pointerup', this.onUp, { passive: false });
    el.addEventListener('pointercancel', this.onCancelEvt, { passive: true });
    el.addEventListener('lostpointercapture', this.onCancelEvt, { passive: true });
    el.addEventListener('pointerleave', this.onLeave, { passive: true });
    this.keyTarget.addEventListener('keydown', this.onKeyDown);
    this.keyTarget.addEventListener('keyup', this.onKeyUp);
    this.keyTarget.addEventListener('blur', this.onBlur);
  }

  /** 入力を受け付けるか。切り替えるたびに、押している指とキーを忘れる */
  setActive(active: boolean): void {
    if (this.activeFlag === active) return;
    this.activeFlag = active;
    this.pointer = null;
    this.heldConfirm.clear();
  }

  dispose(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMoveEvt);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancelEvt);
    el.removeEventListener('lostpointercapture', this.onCancelEvt);
    el.removeEventListener('pointerleave', this.onLeave);
    this.keyTarget.removeEventListener('keydown', this.onKeyDown);
    this.keyTarget.removeEventListener('keyup', this.onKeyUp);
    this.keyTarget.removeEventListener('blur', this.onBlur);
    this.setActive(false);
  }

  /** e の位置を、要素の左上からの位置にして x, y に置く */
  private localize(e: PointerLike): void {
    const r = this.el.getBoundingClientRect();
    this.x = e.clientX - r.left;
    this.y = e.clientY - r.top;
  }

  private readonly onDown = (evt: Event): void => {
    if (!this.activeFlag) return;
    const e = evt as PointerLike;
    // 指とペンが触れたときも 0 になる
    if (e.button !== 0) return;
    if (e.pointerType !== 'mouse') e.preventDefault();
    if (this.pointer !== null) return;
    this.pointer = e.pointerId;
    this.pressedAt = this.now() / 1000;
    try {
      this.el.setPointerCapture?.(e.pointerId);
    } catch {
      // すでに離れた指のイベントが遅れて届いた場合など
    }
    this.localize(e);
    this.h.onPress(this.x, this.y);
  };

  private readonly onMoveEvt = (evt: Event): void => {
    if (!this.activeFlag) return;
    const e = evt as PointerLike;
    if (this.pointer === null) {
      // ボタンを押していないマウスはホバーとして伝える。指は触れている間しか届かない
      if (e.pointerType !== 'mouse') return;
      this.localize(e);
      this.h.onMove(this.x, this.y, false);
      return;
    }
    if (e.pointerId !== this.pointer) return;
    this.localize(e);
    this.h.onMove(this.x, this.y, true);
  };

  private readonly onUp = (evt: Event): void => {
    const e = evt as PointerLike;
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    if (!this.activeFlag) return;
    if (e.pointerType !== 'mouse') e.preventDefault();
    this.localize(e);
    this.h.onRelease(this.x, this.y, this.pressedAt);
  };

  private readonly onCancelEvt = (evt: Event): void => {
    const e = evt as PointerLike;
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    if (this.activeFlag) this.h.onCancel();
  };

  /** ホバーしていたマウスが要素の外へ出た。押している指は、捕まえてあるので外へ出ても追い続ける */
  private readonly onLeave = (evt: Event): void => {
    const e = evt as PointerLike;
    if (!this.activeFlag || this.pointer !== null || e.pointerType !== 'mouse') return;
    this.h.onCancel();
  };

  private readonly onKeyDown = (evt: Event): void => {
    if (!this.activeFlag) return;
    const e = evt as KeyLike;
    // ブラウザのショートカット（Ctrl+D など）と、ボタンなどに届いたキーは奪わない
    if (e.ctrlKey || e.metaKey || e.altKey || isInteractiveTarget(e.target)) return;
    const key = e.key.toLowerCase();
    const move = MOVE_KEYS.get(key);
    if (move) {
      e.preventDefault();
      this.h.onKeyMove(move[0], move[1]);
      return;
    }
    if (CONFIRM_KEYS.has(key)) {
      e.preventDefault();
      if (!e.repeat && !this.heldConfirm.has(key)) this.heldConfirm.set(key, this.now() / 1000);
    }
  };

  private readonly onKeyUp = (evt: Event): void => {
    if (!this.activeFlag) return;
    const e = evt as KeyLike;
    const key = e.key.toLowerCase();
    const pressedAt = this.heldConfirm.get(key);
    if (pressedAt === undefined) return;
    this.heldConfirm.delete(key);
    // 押している間にフォーカスがボタンなどへ移ったら、既定の動作を止めず、決めもしない
    if (isInteractiveTarget(e.target)) return;
    e.preventDefault();
    this.h.onKeyConfirm(pressedAt);
  };

  /** ウィンドウからフォーカスが外れると keyup が届かないので、押しているキーを忘れる */
  private readonly onBlur = (): void => {
    this.heldConfirm.clear();
  };
}
