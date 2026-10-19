import type { FatalCause } from '../../shared/fatal.ts';
import { errorMessage } from '../../shared/errors.ts';
import { createMachineStore } from '../../shared/machine.ts';
import type { MachineStore, Transition as MachineTransition } from '../../shared/machine.ts';
import { pauseMenuStep } from '../../shared/pause-menu.ts';
import type { PauseMenuEvent, PauseSheet } from '../../shared/pause-menu.ts';
import type { Records, RecordsStore } from './records-model.ts';
import type { GamePort, RunResult } from './types.ts';

/**
 * ブラックジャックの画面の状態機械。画面（React）はイベントを送り、ゲームへの命令はここで決める。
 * `transition` は純粋関数で、命令（Command）は `createControllerStore` が GamePort と記録へ実行する。
 */

export type Phase =
  | { k: 'loading' }
  | { k: 'error'; cause: FatalCause; message: string }
  | { k: 'title'; sheet: null | 'settings' }
  | { k: 'playing' }
  | { k: 'paused'; sheet: PauseSheet }
  /** 最後のラウンドを終え（か、破産し）、結果画面までの儀式を見せている。一時停止はできない */
  | { k: 'ending' }
  /** shownAt は結果画面を出した時刻（ms）。直後の操作は受け付けない */
  | { k: 'result'; result: RunResult; shownAt: number };

export type ControllerEvent =
  /** 一時停止中の画面の操作と、Escape キー */
  | PauseMenuEvent
  | { t: 'loaded' }
  /** ゲームを続けられなくなった。cause で画面に出す文言を選ぶ */
  | { t: 'fatal'; cause: FatalCause; message: string }
  /** タイトルでプレイを始める。ユーザー操作（click）の中で送る */
  | { t: 'start' }
  | { t: 'pause' }
  /** タブが隠れた */
  | { t: 'hidden' }
  /** ゲームがプレイを始めた。開発用の操作口から始めたプレイでは、画面の状態と関係なく届く */
  | { t: 'started' }
  | { t: 'runEnding' }
  | { t: 'finished'; result: RunResult }
  | { t: 'retry' }
  | { t: 'toTitle' };

type Command =
  | { c: 'start'; bestScore: number }
  | { c: 'setPaused'; paused: boolean }
  | { c: 'endRun' }
  /** 記録へ結果を反映する。1 回のプレイにつき 1 回だけ出し、練習のプレイ（RunResult.practice）では出さない */
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

const PLAYING: Phase = { k: 'playing' };

/** 命令を出さずに state へ移る（同じオブジェクトなら何も変わらない） */
const to = (state: Phase): Transition => ({ state, commands: [] });

const start = (ctx: ControllerContext): Transition => ({ state: PLAYING, commands: [{ c: 'start', bestScore: ctx.records.bestScore }] });

const pause = (): Transition => ({ state: { k: 'paused', sheet: null }, commands: [{ c: 'setPaused', paused: true }] });

/** ゲームがプレイを始めた。どの画面からでも、プレイ中へ移る（ゲームはもう始めているので命令は出さない） */
function started(state: Phase): Transition {
  if (state.k === 'loading' || state.k === 'error' || state.k === 'playing') return to(state);
  return to(PLAYING);
}

const toTitle = (): Transition => ({ state: { k: 'title', sheet: null }, commands: [{ c: 'endRun' }] });

export function transition(state: Phase, event: ControllerEvent, ctx: ControllerContext): Transition {
  if (event.t === 'fatal') {
    if (state.k === 'error') return to(state);
    return { state: { k: 'error', cause: event.cause, message: event.message }, commands: state.k === 'loading' ? [] : [{ c: 'endRun' }] };
  }

  if (event.t === 'started') return started(state);

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
          return start(ctx);
        default:
          return to(state);
      }

    case 'playing':
      switch (event.t) {
        case 'pause':
        case 'hidden':
        case 'escape':
          return pause();
        case 'runEnding':
          return to({ k: 'ending' });
        default:
          return to(state);
      }

    case 'paused': {
      // 一時停止中のゲームは世界を進めないので、終わり（runEnding / finished）は届かない
      const step = pauseMenuStep(state.sheet, event.t);
      if (!step) return to(state);
      switch (step.k) {
        case 'sheet':
          return to({ ...state, sheet: step.sheet });
        case 'resume':
          return { state: PLAYING, commands: [{ c: 'setPaused', paused: false }] };
        case 'retry':
          return start(ctx);
        case 'title':
          return toTitle();
      }
    }

    case 'ending':
      if (event.t !== 'finished') return to(state);
      return {
        state: { k: 'result', result: event.result, shownAt: ctx.now },
        commands: event.result.practice ? [] : [{ c: 'commit', result: event.result }],
      };

    case 'result':
      if (event.t !== 'retry' && event.t !== 'toTitle') return to(state);
      if (ctx.now - state.shownAt < RESULT_INPUT_GUARD_MS) return to(state);
      return event.t === 'retry' ? start(ctx) : toTitle();
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
        port.start(cmd.bestScore);
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
