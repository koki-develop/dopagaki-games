/** 次の状態と、その状態へ移るときに実行する命令 */
export type Transition<S, C> = { readonly state: S; readonly commands: readonly C[] };

/** 画面の状態機械を、React から useSyncExternalStore で使える形にしたもの */
export interface MachineStore<S, E> {
  getSnapshot(): S;
  subscribe(listener: () => void): () => void;
  /**
   * 状態を進め、命令を実行する。命令の実行中に届いたイベントは、その後で順に処理する。
   * transition が例外を投げたら、まだ処理していないイベントを捨ててから例外をそのまま投げる
   */
  dispatch(event: E): void;
}

type MachineOptions<S, E, C> = {
  initial: S;
  /** 純粋関数。状態が変わらないときは同じオブジェクトを返す */
  transition(state: S, event: E): Transition<S, C>;
  execute(command: C): void;
  /**
   * 命令が例外を投げた。同じ遷移の残りの命令は実行しない。
   * 返したイベントは、いま処理しているイベントの後で処理する。null なら何もしない
   */
  failed(error: unknown, state: S): E | null;
};

/**
 * 状態機械の器。遷移は `transition` が決め、命令は React の更新関数の外で、遷移ごとにちょうど 1 回だけ実行する。
 * 状態が変わったときだけ購読者へ知らせる。
 */
export function createMachineStore<S, E, C>(opts: MachineOptions<S, E, C>): MachineStore<S, E> {
  let state = opts.initial;
  const listeners = new Set<() => void>();
  const queue: E[] = [];
  let running = false;

  const step = (event: E): void => {
    const { state: next, commands } = opts.transition(state, event);
    const changed = next !== state;
    state = next;
    for (const cmd of commands) {
      try {
        opts.execute(cmd);
      } catch (e) {
        const followUp = opts.failed(e, state);
        if (followUp !== null) queue.push(followUp);
        break;
      }
    }
    if (changed) for (const l of listeners) l();
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispatch: (event) => {
      queue.push(event);
      if (running) return;
      running = true;
      try {
        for (let e = queue.shift(); e !== undefined; e = queue.shift()) step(e);
      } catch (error) {
        queue.length = 0;
        throw error;
      } finally {
        running = false;
      }
    },
  };
}
