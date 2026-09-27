import { errorMessage } from '../../shared/errors.ts';
import type { RecordsStore } from './records.ts';
import type { FatalCause, GamePort, RunMode, RunResult } from './types.ts';

/**
 * ブロック崩しの画面の状態機械。画面（React）はイベントを送り、ゲームへの命令はここで決める。
 * `transition` は純粋関数で、命令（Command）は `createControllerStore` が GamePort と記録へ実行する。
 */

/** 画面の上に重ねるもの。タイトルでは設定だけを開ける */
type Sheet = null | 'settings' | 'confirmRetry' | 'confirmTitle';

export type Phase =
  | { k: 'loading' }
  | { k: 'error'; cause: FatalCause; message: string }
  | { k: 'title'; sheet: null | 'settings' }
  | { k: 'stages' }
  | { k: 'ready'; mode: RunMode }
  | { k: 'playing'; mode: RunMode }
  | { k: 'paused'; mode: RunMode; sheet: Sheet }
  /** 勝敗が決まり、結果画面までの演出を見せている。一時停止はできない */
  | { k: 'ending'; mode: RunMode }
  /** shownAt は結果画面を出した時刻（ms）。直後の操作は受け付けない */
  | { k: 'result'; mode: RunMode; result: RunResult; shownAt: number };

export type ControllerEvent =
  | { t: 'loaded' }
  /** ゲームを続けられなくなった。cause で画面に出す文言を選ぶ */
  | { t: 'fatal'; cause: FatalCause; message: string }
  | { t: 'openStages' }
  | { t: 'back' }
  | { t: 'choose'; mode: RunMode }
  | { t: 'start' }
  | { t: 'pause' }
  /** タブが隠れた */
  | { t: 'hidden' }
  | { t: 'resume' }
  | { t: 'askRetry' }
  | { t: 'askTitle' }
  | { t: 'confirm' }
  | { t: 'cancel' }
  | { t: 'openSettings' }
  | { t: 'closeSettings' }
  | { t: 'runEnding' }
  | { t: 'finished'; result: RunResult }
  | { t: 'retry' }
  | { t: 'next' }
  | { t: 'toTitle' }
  | { t: 'escape' };

export type Command =
  | { c: 'prepare'; mode: RunMode; previousBest: number }
  | { c: 'begin' }
  | { c: 'setPaused'; paused: boolean }
  | { c: 'endRun' }
  /** 記録へ結果を反映する。1 プレイにつき 1 回だけ出す */
  | { c: 'commit'; result: RunResult };

export type ControllerContext = {
  /** いまの時刻（ms） */
  now: number;
  stageCount: number;
  /** 選べるステージの数 */
  selectableStages: number;
  best(mode: RunMode): number;
};

type Transition = { state: Phase; commands: Command[] };

/**
 * 結果画面の演出の時刻（ms、結果画面を出した時点から）。CSS のアニメーションへは、結果画面がカスタムプロパティで渡す。
 * 見出しは headingMs かけて叩きつけられ、その 60% の時点（330ms）で縮みきって着地する。
 */
export const RESULT_REVEAL = {
  /** 見出しが叩きつけられる演出の長さ */
  headingMs: 550,
  /** 見出しの着地の直後。ここから操作を受け付け、スコアのカウントアップを始める */
  settleMs: 350,
  /** スコアの枠が弾けて出る時刻 */
  scorePopAtMs: 250,
  /** スコアの枠と NEW BEST! が弾けて出る演出の長さ */
  popMs: 400,
  /** スコアのカウントアップの長さ */
  countUpMs: 1100,
  /** NEW BEST! が弾けて出る時刻 */
  newBestAtMs: 1100,
} as const;

/** 結果画面を出してから操作を受け付けるまでの時間（ms）。演出を飛ばすための連打で、次の操作まで押してしまわないようにする */
export const RESULT_INPUT_GUARD_MS = RESULT_REVEAL.settleMs;

export const hasNextStage = (result: RunResult, stageCount: number): boolean =>
  result.mode.kind === 'stage' && result.cleared && result.mode.index + 1 < stageCount;

/** 命令を出さずに state へ移る（同じオブジェクトなら何も変わらない） */
const to = (state: Phase): Transition => ({ state, commands: [] });

/** 新しいプレイを用意して、すぐに始める（結果画面や一時停止からのやり直し） */
const restart = (mode: RunMode, ctx: ControllerContext): Transition => ({
  state: { k: 'playing', mode },
  commands: [{ c: 'prepare', mode, previousBest: ctx.best(mode) }, { c: 'begin' }],
});

const choose = (mode: RunMode, ctx: ControllerContext): Transition => ({
  state: { k: 'ready', mode },
  commands: [{ c: 'prepare', mode, previousBest: ctx.best(mode) }],
});

const finish = (mode: RunMode, result: RunResult, ctx: ControllerContext): Transition => ({
  state: { k: 'result', mode, result, shownAt: ctx.now },
  commands: [{ c: 'commit', result }],
});

const pause = (mode: RunMode): Transition => ({ state: { k: 'paused', mode, sheet: null }, commands: [{ c: 'setPaused', paused: true }] });

const isStage = (mode: RunMode, ctx: ControllerContext): boolean =>
  mode.kind === 'stage' && Number.isInteger(mode.index) && mode.index >= 0 && mode.index < Math.min(ctx.stageCount, ctx.selectableStages);

/** switch で扱い漏れがないことを型で確かめる。実行時に来たら状態の型と実装が食い違っている */
const unreachable = (v: never): never => {
  throw new Error(`unreachable: ${String(v)}`);
};

export function transition(state: Phase, event: ControllerEvent, ctx: ControllerContext): Transition {
  if (event.t === 'fatal') {
    if (state.k === 'error') return to(state);
    return { state: { k: 'error', cause: event.cause, message: event.message }, commands: state.k === 'loading' ? [] : [{ c: 'endRun' }] };
  }

  switch (state.k) {
    case 'loading':
      return event.t === 'loaded' ? to({ k: 'title', sheet: null }) : to(state);

    case 'error':
      return to(state);

    case 'title':
      if (state.sheet === 'settings') {
        return event.t === 'closeSettings' || event.t === 'escape' ? to({ k: 'title', sheet: null }) : to(state);
      }
      switch (event.t) {
        case 'openSettings':
          return to({ k: 'title', sheet: 'settings' });
        case 'openStages':
          return to({ k: 'stages' });
        case 'choose':
          return event.mode.kind === 'endless' ? choose(event.mode, ctx) : to(state);
        default:
          return to(state);
      }

    case 'stages':
      switch (event.t) {
        case 'back':
        case 'escape':
          return to({ k: 'title', sheet: null });
        case 'choose':
          return isStage(event.mode, ctx) ? choose(event.mode, ctx) : to(state);
        default:
          return to(state);
      }

    case 'ready':
      return event.t === 'start' ? { state: { k: 'playing', mode: state.mode }, commands: [{ c: 'begin' }] } : to(state);

    case 'playing':
      switch (event.t) {
        case 'pause':
        case 'hidden':
        case 'escape':
          return pause(state.mode);
        case 'runEnding':
          return to({ k: 'ending', mode: state.mode });
        case 'finished':
          return finish(state.mode, event.result, ctx);
        default:
          return to(state);
      }

    case 'paused':
      // 一時停止中のゲームは世界を進めないので、勝敗（runEnding / finished）は届かない
      switch (state.sheet) {
        case null:
          switch (event.t) {
            case 'resume':
            case 'escape':
              return { state: { k: 'playing', mode: state.mode }, commands: [{ c: 'setPaused', paused: false }] };
            case 'askRetry':
              return to({ ...state, sheet: 'confirmRetry' });
            case 'askTitle':
              return to({ ...state, sheet: 'confirmTitle' });
            case 'openSettings':
              return to({ ...state, sheet: 'settings' });
            default:
              return to(state);
          }
        case 'settings':
          return event.t === 'closeSettings' || event.t === 'escape' ? to({ ...state, sheet: null }) : to(state);
        case 'confirmRetry':
        case 'confirmTitle':
          switch (event.t) {
            case 'cancel':
            case 'escape':
              return to({ ...state, sheet: null });
            case 'confirm':
              return state.sheet === 'confirmRetry' ? restart(state.mode, ctx) : { state: { k: 'title', sheet: null }, commands: [{ c: 'endRun' }] };
            default:
              return to(state);
          }
        default:
          return unreachable(state);
      }

    case 'ending':
      return event.t === 'finished' ? finish(state.mode, event.result, ctx) : to(state);

    case 'result': {
      if (event.t !== 'retry' && event.t !== 'next' && event.t !== 'toTitle') return to(state);
      if (ctx.now - state.shownAt < RESULT_INPUT_GUARD_MS) return to(state);
      if (event.t === 'retry') return restart(state.mode, ctx);
      if (event.t === 'toTitle') return { state: { k: 'title', sheet: null }, commands: [{ c: 'endRun' }] };
      const r = state.result;
      if (r.mode.kind !== 'stage' || !hasNextStage(r, ctx.stageCount)) return to(state);
      return restart({ kind: 'stage', index: r.mode.index + 1 }, ctx);
    }
  }
}

interface ControllerStore {
  getSnapshot(): Phase;
  subscribe(listener: () => void): () => void;
  /** 状態を進め、命令を実行する。命令の実行中に届いたイベントは、その後で順に処理する */
  dispatch(event: ControllerEvent): void;
}

/**
 * 画面の状態機械を React から useSyncExternalStore で使える形にする。
 * 命令は React の更新関数の外で、ちょうど 1 回だけ実行する。記録は最新の値をその場で読む。
 */
export function createControllerStore(port: GamePort, records: RecordsStore, now: () => number): ControllerStore {
  let state: Phase = { k: 'loading' };
  const listeners = new Set<() => void>();
  const queue: ControllerEvent[] = [];
  let running = false;

  const context = (): ControllerContext => ({
    now: now(),
    stageCount: records.stageCount,
    selectableStages: records.selectableStages(),
    best: (mode) => records.bestFor(mode),
  });

  const execute = (cmd: Command): void => {
    switch (cmd.c) {
      case 'prepare':
        port.prepare(cmd.mode, cmd.previousBest);
        return;
      case 'begin':
        port.begin();
        return;
      case 'setPaused':
        port.setPaused(cmd.paused);
        return;
      case 'endRun':
        port.endRun();
        return;
      case 'commit':
        records.commit(cmd.result);
        return;
    }
  };

  const step = (event: ControllerEvent): void => {
    const { state: next, commands } = transition(state, event, context());
    const changed = next !== state;
    state = next;
    for (const cmd of commands) {
      try {
        execute(cmd);
      } catch (e) {
        if (state.k !== 'error') queue.push({ t: 'fatal', cause: 'internal', message: errorMessage(e) });
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
        for (let e = queue.shift(); e; e = queue.shift()) step(e);
      } finally {
        running = false;
      }
    },
  };
}

/**
 * ゲーム本体ができあがる前から状態機械に渡しておく GamePort。命令は、結びつけたゲームへそのまま渡す。
 * ゲームがまだない（読み込み中・破棄後）ときの命令は捨てる。
 */
export function createPortRelay(): GamePort & { bind(port: GamePort | null): void } {
  let target: GamePort | null = null;
  return {
    bind: (port) => {
      target = port;
    },
    prepare: (mode, previousBest) => target?.prepare(mode, previousBest),
    begin: () => target?.begin(),
    setPaused: (paused) => target?.setPaused(paused),
    endRun: () => target?.endRun(),
  };
}
