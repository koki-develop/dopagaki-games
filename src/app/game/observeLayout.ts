/** 画面上の矩形（CSS ピクセル） */
type Box = { left: number; top: number; width: number; height: number };

export const boxOf = (r: DOMRect): Box => ({ left: r.left, top: r.top, width: r.width, height: r.height });

/**
 * HUD の配置をゲームへ伝える。targets のどれかの大きさが変わるたびに measure で測り直し、前と違うときだけ send へ渡す。
 * 呼んだ時点でも 1 回測る。返す関数で監視をやめる
 */
export function observeLayout<L>(targets: readonly Element[], measure: () => L, same: (a: L | null, b: L) => boolean, send: (layout: L) => void): () => void {
  let last: L | null = null;
  const update = () => {
    const layout = measure();
    if (same(last, layout)) return;
    last = layout;
    send(layout);
  };
  const ro = new ResizeObserver(update);
  for (const el of targets) ro.observe(el);
  update();
  return () => ro.disconnect();
}
