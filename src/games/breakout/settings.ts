import { motionPreference } from '../../juice/motion-preference.ts';
import { sharedGameSettings, standardSettingsSchema } from '../../juice/settings.ts';
import { safeLocalStorage } from '../../juice/storage.ts';

const { schema, items } = standardSettingsSchema('dopagaki:breakout:settings');

/** 設定の画面に並べる項目 */
export const BREAKOUT_SETTING_ITEMS = items;

/** このページで共有するブロック崩しの設定 */
export const breakoutSettings = sharedGameSettings(schema, () => ({ storage: safeLocalStorage(), motion: motionPreference }));
