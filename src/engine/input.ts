/** 離したときの情報。RelativeDrag が 1 つだけ持って使い回すので、呼び出しの外へ持ち出さない */
export type ReleaseInfo = {
  /** 押した時刻（秒、performance.now() / 1000 と同じ時間軸） */
  pressedAt: number;
};

type DragHandlers = {
  /** 指（またはマウス）の横方向の移動量（CSS ピクセル） */
  onMove: (dxPx: number) => void;
  /** 指を離した、または発射キーを離した（発射の合図） */
  onRelease: (info: ReleaseInfo) => void;
};

/** ポインターの入力を受ける要素。HTMLElement がこの形を満たす */
type DragSurface = EventTarget & { setPointerCapture?(pointerId: number): void };

type DragOptions = {
  /** キーボードと blur を受ける相手。省略時は window */
  keyTarget?: EventTarget;
  /** 現在時刻（ms）。省略時は performance.now() */
  now?: () => number;
};

type PointerLike = Event & { pointerId: number; pointerType: string; clientX: number; relatedTarget?: EventTarget | null };
type KeyLike = Event & { key: string; repeat: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean };

/** 動かすキー。小文字にした e.key で引く */
const MOVE_KEYS: ReadonlyMap<string, number> = new Map([
  ['arrowleft', -1],
  ['a', -1],
  ['arrowright', 1],
  ['d', 1],
]);
/** 発射のキー */
const LAUNCH_KEYS: ReadonlySet<string> = new Set([' ', 'enter']);

/** キー操作をその要素自身が使う要素。ダイアログの中はすべて含める */
const INTERACTIVE_SELECTOR = 'button, a[href], input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="dialog"]';

/** closest() を持つ相手（Element がこの形を満たす） */
type Closest = { closest(selector: string): unknown };

/** キーの届いた先が、ボタンや入力欄など、キー操作を自分で使う要素（またはダイアログの中）か */
function isInteractiveTarget(target: EventTarget | null): boolean {
  const t = target as Partial<Closest> | null;
  return typeof t?.closest === 'function' && t.closest(INTERACTIVE_SELECTOR) != null;
}

/**
 * 相対ドラッグの入力。画面のどこを触っても、指の移動量だけをパドルへ伝える。
 *
 * - 入力を受け付けるのは `setActive(true)` の間だけ。切り替えるたびに、押している指・キー・マウスの位置を忘れる
 * - Pointer Events に統一する。`pointercancel` は離したものとして扱わない（発射しない）
 * - 複数の指が触れているときは、最初に触れた指だけを使う。その指が離れたら残っている指へ引き継ぐ
 * - マウスは押していなくても移動量を伝える（デスクトップ向け）。要素の外へ出たら位置を忘れ、戻ったときに飛ばない
 * - 矢印キーと A / D で動かせる。複数押しているときは、最後に押したキーの向き
 * - スペースと Enter は、受け付けている間に押したキーを離したときに発射する（タッチの押して離すと同じ）
 * - ボタン・リンク・入力欄など、キー操作を自分で使う要素（とダイアログの中）に届いたキーは扱わない。
 *   フォーカスした一時停止ボタンを Enter / スペースで押せるようにするため
 * - 既定の動作（スクロールやボタンの押下）を止めるのは、受け付けている間だけ
 */
export class RelativeDrag {
  private readonly el: DragSurface;
  private readonly keyTarget: EventTarget;
  private readonly h: DragHandlers;
  private readonly now: () => number;
  private readonly info: ReleaseInfo = { pressedAt: 0 };
  private activeFlag = false;
  private pointer: number | null = null;
  private lastX = 0;
  /** 触れている指ごとの最後の x */
  private readonly downX = new Map<number, number>();
  /** 触れている指ごとの押した時刻（秒） */
  private readonly downAt = new Map<number, number>();
  private mouseX: number | null = null;
  /** 押している移動キー（押した順） */
  private readonly heldMove: string[] = [];
  /** 受け付けている間に押した発射キーと、その時刻（秒） */
  private readonly heldLaunch = new Map<string, number>();

  constructor(el: DragSurface, handlers: DragHandlers, opts: DragOptions = {}) {
    this.el = el;
    this.h = handlers;
    this.keyTarget = opts.keyTarget ?? window;
    this.now = opts.now ?? (() => performance.now());
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    el.addEventListener('pointermove', this.onMoveEvt, { passive: true });
    el.addEventListener('pointerup', this.onUp, { passive: false });
    el.addEventListener('pointercancel', this.onCancel, { passive: true });
    el.addEventListener('lostpointercapture', this.onCancel, { passive: true });
    el.addEventListener('pointerleave', this.onLeave, { passive: true });
    el.addEventListener('pointerout', this.onOut, { passive: true });
    this.keyTarget.addEventListener('keydown', this.onKeyDown);
    this.keyTarget.addEventListener('keyup', this.onKeyUp);
    this.keyTarget.addEventListener('blur', this.onBlur);
  }

  /** 入力を受け付けるか。切り替えるたびに、押している指・キー・マウスの位置を忘れる */
  setActive(active: boolean): void {
    if (this.activeFlag === active) return;
    this.activeFlag = active;
    this.pointer = null;
    this.downX.clear();
    this.downAt.clear();
    this.mouseX = null;
    this.heldMove.length = 0;
    this.heldLaunch.clear();
  }

  get active(): boolean {
    return this.activeFlag;
  }

  /** キー入力による移動の向き（-1, 0, 1）。フレームごとに呼び出し側で移動量に換算する */
  get keyDirection(): number {
    const n = this.heldMove.length;
    return n > 0 ? (MOVE_KEYS.get(this.heldMove[n - 1]) ?? 0) : 0;
  }

  dispose(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMoveEvt);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancel);
    el.removeEventListener('lostpointercapture', this.onCancel);
    el.removeEventListener('pointerleave', this.onLeave);
    el.removeEventListener('pointerout', this.onOut);
    this.keyTarget.removeEventListener('keydown', this.onKeyDown);
    this.keyTarget.removeEventListener('keyup', this.onKeyUp);
    this.keyTarget.removeEventListener('blur', this.onBlur);
    this.setActive(false);
  }

  private readonly onDown = (evt: Event): void => {
    if (!this.activeFlag) return;
    const e = evt as PointerLike;
    if (e.pointerType !== 'mouse') e.preventDefault();
    this.downX.set(e.pointerId, e.clientX);
    this.downAt.set(e.pointerId, this.now() / 1000);
    try {
      this.el.setPointerCapture?.(e.pointerId);
    } catch {
      // すでに離れた指のイベントが遅れて届いた場合など
    }
    if (this.pointer === null) {
      this.pointer = e.pointerId;
      this.lastX = e.clientX;
    }
  };

  private readonly onMoveEvt = (evt: Event): void => {
    if (!this.activeFlag) return;
    const e = evt as PointerLike;
    if (e.pointerType === 'mouse' && this.pointer === null) {
      if (this.mouseX !== null) this.h.onMove(e.clientX - this.mouseX);
      this.mouseX = e.clientX;
      return;
    }
    if (this.downX.has(e.pointerId)) this.downX.set(e.pointerId, e.clientX);
    if (e.pointerId !== this.pointer) return;
    const dx = e.clientX - this.lastX;
    this.lastX = e.clientX;
    if (e.pointerType === 'mouse') this.mouseX = e.clientX;
    if (dx !== 0) this.h.onMove(dx);
  };

  private readonly onUp = (evt: Event): void => {
    this.release((evt as PointerLike).pointerId, true);
  };

  private readonly onCancel = (evt: Event): void => {
    this.release((evt as PointerLike).pointerId, false);
  };

  /** 要素の外へ出た。マウスの位置を忘れ、戻ってきたときの移動量が飛ばないようにする */
  private readonly onLeave = (): void => {
    this.mouseX = null;
  };

  /** pointerout は子要素への移動でも届くので、ページの外へ出たとき（行き先がない）だけ位置を忘れる */
  private readonly onOut = (evt: Event): void => {
    if (((evt as PointerLike).relatedTarget ?? null) === null) this.mouseX = null;
  };

  private release(id: number, fireRelease: boolean): void {
    if (!this.downX.has(id)) return;
    const pressedAt = this.downAt.get(id) ?? 0;
    this.downX.delete(id);
    this.downAt.delete(id);
    if (id !== this.pointer) return;
    this.pointer = null;
    // 残っている指があれば、その指へ引き継ぐ
    const next = this.downX.entries().next();
    if (!next.done) {
      this.pointer = next.value[0];
      this.lastX = next.value[1];
    }
    if (fireRelease && this.activeFlag) this.fireRelease(pressedAt);
  }

  private fireRelease(pressedAt: number): void {
    this.info.pressedAt = pressedAt;
    this.h.onRelease(this.info);
  }

  private readonly onKeyDown = (evt: Event): void => {
    if (!this.activeFlag) return;
    const e = evt as KeyLike;
    // ブラウザのショートカット（Ctrl+D など）と、ボタンなどに届いたキーは奪わない
    if (e.ctrlKey || e.metaKey || e.altKey || isInteractiveTarget(e.target)) return;
    const key = e.key.toLowerCase();
    if (MOVE_KEYS.has(key)) {
      e.preventDefault();
      if (!this.heldMove.includes(key)) this.heldMove.push(key);
      return;
    }
    if (LAUNCH_KEYS.has(key)) {
      e.preventDefault();
      if (!e.repeat && !this.heldLaunch.has(key)) this.heldLaunch.set(key, this.now() / 1000);
    }
  };

  private readonly onKeyUp = (evt: Event): void => {
    if (!this.activeFlag) return;
    const e = evt as KeyLike;
    const key = e.key.toLowerCase();
    // 押している間にフォーカスがボタンなどへ移っても、押していたキーは忘れる。そのときは既定の動作を止めず、発射もしない
    const own = !isInteractiveTarget(e.target);
    if (MOVE_KEYS.has(key)) {
      if (own) e.preventDefault();
      const i = this.heldMove.indexOf(key);
      if (i >= 0) this.heldMove.splice(i, 1);
      return;
    }
    const pressedAt = this.heldLaunch.get(key);
    if (pressedAt === undefined) return;
    this.heldLaunch.delete(key);
    if (!own) return;
    e.preventDefault();
    this.fireRelease(pressedAt);
  };

  /** ウィンドウからフォーカスが外れると keyup が届かないので、押しているキーとマウスの位置を忘れる */
  private readonly onBlur = (): void => {
    this.heldMove.length = 0;
    this.heldLaunch.clear();
    this.mouseX = null;
  };
}
