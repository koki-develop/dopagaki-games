/** 描画領域。大きさは CSS ピクセルで、変化を observe で知らせる */
export type Surface = {
  readonly width: number;
  readonly height: number;
  /** 大きさが変わるたびに cb を呼ぶ。返した関数で監視をやめる */
  observe(cb: () => void): () => void;
};

/** 要素 el を描画領域にする。大きさの変化は ResizeObserver で知らせる */
export function elementSurface(el: HTMLElement): Surface {
  return {
    get width() {
      return el.clientWidth;
    },
    get height() {
      return el.clientHeight;
    },
    observe(cb) {
      const ro = new ResizeObserver(cb);
      ro.observe(el);
      return () => ro.disconnect();
    },
  };
}
