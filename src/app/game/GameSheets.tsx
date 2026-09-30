import type { GameSettings, SettingItem, SettingValues } from '../../juice/settings.ts';
import type { PauseMenuEvent, PauseSheet } from '../../shared/pause-menu.ts';
import ConfirmDialog from '../ui/ConfirmDialog.tsx';
import PauseMenu from '../ui/PauseMenu.tsx';
import SettingsPanel from '../ui/SettingsPanel.tsx';

const CONFIRM = {
  confirmRetry: { title: 'やり直す？', confirmLabel: 'やり直す' },
  confirmTitle: { title: 'タイトルへ戻る？', confirmLabel: 'タイトルへ' },
} as const;

type Props<T extends SettingValues> = {
  /** 一時停止中。一時停止メニューを出す */
  paused: boolean;
  sheet: PauseSheet;
  /** 確認に添える、失われるものの説明 */
  discardMessage: string;
  settings: GameSettings<T>;
  settingItems: readonly SettingItem<T>[];
  dispatch: (e: PauseMenuEvent) => void;
};

/**
 * ゲームの画面に共通する、一時停止メニュー・確認・設定。どれを出すかは画面の状態機械が決める。
 * 確認を出している間は、一時停止メニューを下げて確認だけを見せる
 */
export default function GameSheets<T extends SettingValues>({ paused, sheet, discardMessage, settings, settingItems, dispatch }: Props<T>) {
  const confirm = sheet === 'confirmRetry' || sheet === 'confirmTitle' ? sheet : null;
  return (
    <>
      {paused && (
        <PauseMenu
          hidden={confirm !== null}
          onResume={() => dispatch({ t: 'resume' })}
          onAskRetry={() => dispatch({ t: 'askRetry' })}
          onSettings={() => dispatch({ t: 'openSettings' })}
          onAskTitle={() => dispatch({ t: 'askTitle' })}
        />
      )}

      {confirm && (
        <ConfirmDialog
          key={confirm}
          title={CONFIRM[confirm].title}
          message={discardMessage}
          confirmLabel={CONFIRM[confirm].confirmLabel}
          onConfirm={() => dispatch({ t: 'confirm' })}
          onCancel={() => dispatch({ t: 'cancel' })}
        />
      )}

      {sheet === 'settings' && <SettingsPanel settings={settings} items={settingItems} onClose={() => dispatch({ t: 'closeSettings' })} />}
    </>
  );
}
