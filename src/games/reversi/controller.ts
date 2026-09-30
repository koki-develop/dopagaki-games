import type { FatalCause } from '../../shared/fatal.ts';
import { errorMessage } from '../../shared/errors.ts';
import { createMachineStore } from '../../shared/machine.ts';
import type { MachineStore, Transition as MachineTransition } from '../../shared/machine.ts';
import { pauseMenuStep } from '../../shared/pause-menu.ts';
import type { PauseMenuEvent, PauseSheet } from '../../shared/pause-menu.ts';
import type { Records, RecordsStore } from './records-model.ts';
import type { GamePort, MatchSetup, RunResult } from './types.ts';

/**
 * リバーシの画面の状態機械。画面（React）はイベントを送り、ゲームへの命令はここで決める。
 * `transition` は純粋関数で、命令（Command）は `createControllerStore` が GamePort と記録へ実行する。
 */

export type Phase =
  | { k: 'loading' }
  | { k: 'error'; cause: FatalCause; message: string }
  | { k: 'title'; sheet: null | 'settings' }
  | { k: 'playing'; setup: MatchSetup }
  | { k: 'paused'; setup: MatchSetup; sheet: PauseSheet }
  /** 終局し、結果画面までの儀式を見せている。一時停止はできない */
  | { k: 'ending'; setup: MatchSetup }
  /** shownAt は結果画面を出した時刻（ms）。直後の操作は受け付けない */
  | { k: 'result'; setup: MatchSetup; result: RunResult; shownAt: number };

export type ControllerEvent =
  /** 一時停止中の画面の操作と、Escape キー */
  | PauseMenuEvent
  | { t: 'loaded' }
  /** ゲームを続けられなくなった。cause で画面に出す文言を選ぶ */
  | { t: 'fatal'; cause: FatalCause; message: string }
  /** タイトルで対局を始める。ユーザー操作（click）の中で送る */
  | { t: 'start'; setup: MatchSetup }
  | { t: 'pause' }
  /** タブが隠れた */
  | { t: 'hidden' }
  /** ゲームが対局を始めた。開発用の操作口から始めた対局では、画面の状態と関係なく届く */
  | { t: 'started'; setup: MatchSetup }
  | { t: 'runEnding' }
  | { t: 'finished'; result: RunResult }
  | { t: 'retry' }
  | { t: 'toTitle' };

type Command =
  | { c: 'start'; setup: MatchSetup; bestScore: number }
  | { c: 'setPaused'; paused: boolean }
  | { c: 'endRun' }
  /** 記録へ結果を反映する。1 局につき 1 回だけ出し、練習の対局（RunResult.practice）では出さない */
  | { c: 'commit'; result: RunResult };

export type ControllerContext = {
  /** いまの時刻（ms） */
  now: number;
  /** いまの記録 */
  records: Records;
};

type Transition = MachineTransition<Phase, Command>;

/** 結果画面を出してから操作を受け付けるまでの時間（ms）。演出を飛ばすための連打で、次の操作まで押してしまわないようにする */
export const RESULT_INPUT_GUARD_MS = 350;

/** 命令を出さずに state へ移る（同じオブジェクトなら何も変わらない） */
const to = (state: Phase): Transition => ({ state, commands: [] });

const start = (setup: MatchSetup, ctx: ControllerContext): Transition => ({
  state: { k: 'playing', setup },
  commands: [{ c: 'start', setup, bestScore: ctx.records.bestScore }],
});

const pause = (setup: MatchSetup): Transition => ({ state: { k: 'paused', setup, sheet: null }, commands: [{ c: 'setPaused', paused: true }] });

/** ゲームが対局を始めた。どの画面からでも、その設定の対局中へ移る（ゲームはもう始めているので命令は出さない） */
function started(state: Phase, setup: MatchSetup): Transition {
  if (state.k === 'loading' || state.k === 'error') return to(state);
  if (state.k === 'playing' && state.setup.human === setup.human) return to(state);
  return to({ k: 'playing', setup });
}

const toTitle = (): Transition => ({ state: { k: 'title', sheet: null }, commands: [{ c: 'endRun' }] });

export function transition(state: Phase, event: ControllerEvent, ctx: ControllerContext): Transition {
  if (event.t === 'fatal') {
    if (state.k === 'error') return to(state);
    return { state: { k: 'error', cause: event.cause, message: event.message }, commands: state.k === 'loading' ? [] : [{ c: 'endRun' }] };
  }

  if (event.t === 'started') return started(state, event.setup);

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
        case 'start':
          return start(event.setup, ctx);
        default:
          return to(state);
      }

    case 'playing':
      switch (event.t) {
        case 'pause':
        case 'hidden':
        case 'escape':
          return pause(state.setup);
        case 'runEnding':
          return to({ k: 'ending', setup: state.setup });
        default:
          return to(state);
      }

    case 'paused': {
      // 一時停止中のゲームは世界を進めないので、終局（runEnding / finished）は届かない
      const step = pauseMenuStep(state.sheet, event.t);
      if (!step) return to(state);
      switch (step.k) {
        case 'sheet':
          return to({ ...state, sheet: step.sheet });
        case 'resume':
          return { state: { k: 'playing', setup: state.setup }, commands: [{ c: 'setPaused', paused: false }] };
        case 'retry':
          return start(state.setup, ctx);
        case 'title':
          return toTitle();
      }
    }

    case 'ending':
      if (event.t !== 'finished') return to(state);
      return {
        state: { k: 'result', setup: state.setup, result: event.result, shownAt: ctx.now },
        commands: event.result.practice ? [] : [{ c: 'commit', result: event.result }],
      };

    case 'result':
      if (event.t !== 'retry' && event.t !== 'toTitle') return to(state);
      if (ctx.now - state.shownAt < RESULT_INPUT_GUARD_MS) return to(state);
      return event.t === 'retry' ? start(state.setup, ctx) : toTitle();
  }
}

/**
 * 画面の状態機械を React から useSyncExternalStore で使える形にする。記録は最新の値をその場で読む。
 * 命令が失敗したら、ゲームの処理の失敗（internal）としてエラー画面へ移る。
 */
export function createControllerStore(port: GamePort, records: RecordsStore, now: () => number): MachineStore<Phase, ControllerEvent> {
  const execute = (cmd: Command): void => {
    switch (cmd.c) {
      case 'start':
        port.start(cmd.setup, cmd.bestScore);
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
    transition: (state, event) => transition(state, event, { now: now(), records: records.get() }),
    execute,
    failed: (e, state) => (state.k === 'error' ? null : { t: 'fatal', cause: 'internal', message: errorMessage(e) }),
  });
}
