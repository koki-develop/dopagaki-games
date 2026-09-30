/**
 * 毎フレーム届く値を、表示係へ渡す中継。
 * 値を送る側は表示係より先にできあがることがあるので、最後の値を覚えておき、つないだ時点で渡す。
 * 同時につなげる表示係は 1 つだけ。
 */
export class LatestFeed<T> {
  private has = false;
  private latest: T | undefined = undefined;
  private listener: ((value: T) => void) | null = null;

  push = (value: T): void => {
    this.has = true;
    this.latest = value;
    this.listener?.(value);
  };

  connect(listener: (value: T) => void): () => void {
    this.listener = listener;
    if (this.has) listener(this.latest as T);
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }
}

/**
 * ときどき起きる出来事を、表示係へ渡す中継。LatestFeed と違い、値を覚えない（つないだ後に起きたものだけを渡す）。
 * 同時につなげる表示係は 1 つだけ
 */
export class EventFeed<T> {
  private listener: ((value: T) => void) | null = null;

  push = (value: T): void => {
    this.listener?.(value);
  };

  connect(listener: (value: T) => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }
}
