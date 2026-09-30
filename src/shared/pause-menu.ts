/**
 * 一時停止中に重ねるもの。null は一時停止メニューだけ。確認はどちらも、今のプレイを記録せずに捨てる操作の前に出す
 */
export type PauseSheet = null | 'settings' | 'confirmRetry' | 'confirmTitle';

/** 一時停止中の画面から送る操作 */
export type PauseMenuEvent =
  | { t: 'resume' }
  | { t: 'askRetry' }
  | { t: 'askTitle' }
  | { t: 'confirm' }
  | { t: 'cancel' }
  | { t: 'openSettings' }
  | { t: 'closeSettings' }
  | { t: 'escape' };

/**
 * 一時停止中の操作の行き先。
 * - sheet: 重ねるものを sheet に変える
 * - resume: 再開する
 * - retry: 確認のうえ、やり直す
 * - title: 確認のうえ、タイトルへ戻る
 */
type PauseMenuStep = { k: 'sheet'; sheet: PauseSheet } | { k: 'resume' } | { k: 'retry' } | { k: 'title' };

const RESUME: PauseMenuStep = { k: 'resume' };
const RETRY: PauseMenuStep = { k: 'retry' };
const TITLE: PauseMenuStep = { k: 'title' };
const sheetStep = (sheet: PauseSheet): PauseMenuStep => ({ k: 'sheet', sheet });

/**
 * 一時停止中に重ねているもの sheet の上で、操作 t がどこへ進むか。当てはまらない操作は null。
 * Escape は、重ねているものを閉じる。何も重ねていなければ再開する
 */
export function pauseMenuStep(sheet: PauseSheet, t: string): PauseMenuStep | null {
  switch (sheet) {
    case null:
      switch (t) {
        case 'resume':
        case 'escape':
          return RESUME;
        case 'askRetry':
          return sheetStep('confirmRetry');
        case 'askTitle':
          return sheetStep('confirmTitle');
        case 'openSettings':
          return sheetStep('settings');
        default:
          return null;
      }
    case 'settings':
      return t === 'closeSettings' || t === 'escape' ? sheetStep(null) : null;
    case 'confirmRetry':
    case 'confirmTitle':
      switch (t) {
        case 'cancel':
        case 'escape':
          return sheetStep(null);
        case 'confirm':
          return sheet === 'confirmRetry' ? RETRY : TITLE;
        default:
          return null;
      }
  }
}
