/** 引数を受け取って何も返さない命令 */
type Command = (...args: never[]) => void;

/** 命令だけを持つ口 P と、命令を渡す相手を結びつける bind */
export type PortRelay<P> = P & {
  /** 命令を渡す相手。null なら、以後の命令は捨てる */
  bind(port: P | null): void;
};

/**
 * 相手ができあがる前から渡しておける、命令の口 P の中継（画面の状態機械が、読み込み中のゲーム本体へ命令するのに使う）。
 * 命令は結びつけた相手へそのまま渡し、相手がいない（できる前・捨てた後）ときの命令は捨てる。
 * commands には P の命令の名前をすべて挙げる（型が挙げ漏れを見つける）
 */
export function createPortRelay<P extends Record<keyof P, Command>>(commands: { readonly [K in keyof P]: true }): PortRelay<P> {
  let target: P | null = null;
  const relay: Record<string, unknown> = {
    bind: (port: P | null): void => {
      target = port;
    },
  };
  for (const name of Object.keys(commands) as (keyof P & string)[]) {
    relay[name] = (...args: never[]): void => {
      const t = target;
      if (t) (t[name] as Command).apply(t, args);
    };
  }
  return relay as PortRelay<P>;
}
