import { useId, useSyncExternalStore } from 'react';
import type { GameSettings, SettingItem, SettingValues } from '../../juice/settings.ts';
import Dialog from './Dialog.tsx';

type Props<T extends SettingValues> = {
  settings: GameSettings<T>;
  /** 並べる項目。各項目はオン / オフのラジオボタン */
  items: readonly SettingItem<T>[];
  onClose: () => void;
};

/** ゲームの設定。どのゲームでも、そのゲームの項目と保存先を渡して開く */
export default function SettingsPanel<T extends SettingValues>({ settings, items, onClose }: Props<T>) {
  const s = useSyncExternalStore(settings.subscribe, settings.get);
  const name = useId();

  return (
    <Dialog title="設定">
      {items.map(({ key, label }, i) => (
        <fieldset key={key} className="setting">
          <legend className="setting-label">{label}</legend>
          <div className="segmented">
            {[true, false].map((on) => (
              <label key={String(on)}>
                <input
                  type="radio"
                  name={`${name}-${key}`}
                  checked={s[key] === on}
                  onChange={() => settings.update({ [key]: on } as Partial<T>)}
                  data-autofocus={i === 0 && s[key] === on ? true : undefined}
                />
                <span>{on ? 'オン' : 'オフ'}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="panel-actions">
        <button type="button" className="btn" onClick={onClose}>
          閉じる
        </button>
      </div>
    </Dialog>
  );
}
