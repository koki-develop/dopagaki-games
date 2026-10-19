import { motionPreference } from '../../juice/motion-preference.ts';
import { sharedGameSettings, standardSettingsSchema } from '../../juice/settings.ts';
import { safeLocalStorage } from '../../juice/storage.ts';

const { schema, items } = standardSettingsSchema('dopagaki:blackjack:settings');

/** 設定の画面に並べる項目 */
export const BLACKJACK_SETTING_ITEMS = items;

/** このページで共有するブラックジャックの設定 */
export const blackjackSettings = sharedGameSettings(schema, () => ({ storage: safeLocalStorage(), motion: motionPreference }));
