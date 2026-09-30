import type { FatalCause } from '../../shared/fatal.ts';
import { errorMessage } from '../../shared/errors.ts';
import { createMachineStore } from '../../shared/machine.ts';
import type { MachineStore, Transition as MachineTransition } from '../../shared/machine.ts';
import { pauseMenuStep } from '../../shared/pause-menu.ts';
import type { PauseMenuEvent, PauseSheet } from '../../shared/pause-menu.ts';
import type { RecordsStore } from './records-model.ts';
import type { GamePort, RunMode, RunResult } from './types.ts';

/**
 * ブロック崩しの画面の状態機械。画面（React）はイベントを送り、ゲームへの命令はここで決める。
 * `transition` は純粋関数で、命令（Command）は `createControllerStore` が GamePort と記録へ実行する。
 */

export type Phase =
  | { k: 'loading' }
  | { k: 'error'; cause: FatalCause; message: string }
  | { k: 'title'; sheet: null | 'settings' }
  | { k: 'stages' }
  | { k: 'ready'; mode: RunMode }
  | { k: 'playing'; mode: RunMode }
  | { k: 'paused'; mode: RunMode; sheet: PauseSheet }
  /** 勝敗が決まり、結果画面までの演出を見せている。一時停止はできない */
  | { k: 'ending'; mode: RunMode }
  /** shownAt は結果画面を出した時刻（ms）。直後の操作は受け付けない */
  | { k: 'result'; mode: RunMode; result: RunResult; shownAt: number };

export type ControllerEvent =
  /** 一時停止中の画面の操作と、Escape キー */
  | PauseMenuEvent
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
  | { t: 'runEnding' }
  | { t: 'finished'; result: RunResult }
  | { t: 'retry' }
  | { t: 'next' }
  | { t: 'toTitle' };

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

type Transition = MachineTransition<Phase, Command>;

/** 結果画面を出してから操作を受け付けるまでの時間（ms）。演出を飛ばすための連打で、次の操作まで押してしまわないようにする */
export const RESULT_INPUT_GUARD_MS = 350;

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

    case 'paused': {
      // 一時停止中のゲームは世界を進めないので、勝敗（runEnding / finished）は届かない
      const step = pauseMenuStep(state.sheet, event.t);
      if (!step) return to(state);
      switch (step.k) {
        case 'sheet':
          return to({ ...state, sheet: step.sheet });
        case 'resume':
          return { state: { k: 'playing', mode: state.mode }, commands: [{ c: 'setPaused', paused: false }] };
        case 'retry':
          return restart(state.mode, ctx);
        case 'title':
          return { state: { k: 'title', sheet: null }, commands: [{ c: 'endRun' }] };
      }
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

/**
 * 画面の状態機械を React から useSyncExternalStore で使える形にする。記録は最新の値をその場で読む。
 * 命令が失敗したら、ゲームの処理の失敗（internal）としてエラー画面へ移る。
 */
export function createControllerStore(port: GamePort, records: RecordsStore, now: () => number): MachineStore<Phase, ControllerEvent> {
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

  return createMachineStore<Phase, ControllerEvent, Command>({
    initial: { k: 'loading' },
    transition: (state, event) => transition(state, event, context()),
    execute,
    failed: (e, state) => (state.k === 'error' ? null : { t: 'fatal', cause: 'internal', message: errorMessage(e) }),
  });
}
