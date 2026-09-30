import { motionPreference } from '../../juice/motion-preference.ts';
import { sharedGameSettings, standardSettingsSchema } from '../../juice/settings.ts';
import { safeLocalStorage } from '../../juice/storage.ts';

const { schema, items } = standardSettingsSchema('dopagaki:reversi:settings');

/** 設定の画面に並べる項目 */
export const REVERSI_SETTING_ITEMS = items;

/** このページで共有するリバーシの設定 */
export const reversiSettings = sharedGameSettings(schema, () => ({ storage: safeLocalStorage(), motion: motionPreference }));
