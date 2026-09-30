import { describe, expect, test } from 'bun:test';
import { pauseMenuStep } from './pause-menu.ts';

describe('pauseMenuStep', () => {
  test('一時停止メニューからは、再開・確認・設定へ進む。Escape は再開する', () => {
    expect(pauseMenuStep(null, 'resume')).toEqual({ k: 'resume' });
    expect(pauseMenuStep(null, 'escape')).toEqual({ k: 'resume' });
    expect(pauseMenuStep(null, 'askRetry')).toEqual({ k: 'sheet', sheet: 'confirmRetry' });
    expect(pauseMenuStep(null, 'askTitle')).toEqual({ k: 'sheet', sheet: 'confirmTitle' });
    expect(pauseMenuStep(null, 'openSettings')).toEqual({ k: 'sheet', sheet: 'settings' });
    expect(pauseMenuStep(null, 'confirm')).toBeNull();
  });

  test('設定と確認は、閉じる操作と Escape で一時停止メニューへ戻る', () => {
    expect(pauseMenuStep('settings', 'closeSettings')).toEqual({ k: 'sheet', sheet: null });
    expect(pauseMenuStep('settings', 'escape')).toEqual({ k: 'sheet', sheet: null });
    expect(pauseMenuStep('settings', 'resume')).toBeNull();
    expect(pauseMenuStep('confirmRetry', 'cancel')).toEqual({ k: 'sheet', sheet: null });
    expect(pauseMenuStep('confirmTitle', 'escape')).toEqual({ k: 'sheet', sheet: null });
  });

  test('確認を承ると、やり直すかタイトルへ戻る', () => {
    expect(pauseMenuStep('confirmRetry', 'confirm')).toEqual({ k: 'retry' });
    expect(pauseMenuStep('confirmTitle', 'confirm')).toEqual({ k: 'title' });
    expect(pauseMenuStep('confirmRetry', 'resume')).toBeNull();
  });
});
