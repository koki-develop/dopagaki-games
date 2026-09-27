import { useId } from 'react';
import { settings } from '../juice/settings.ts';
import type { Settings } from '../juice/settings.ts';
import Dialog from './ui/Dialog.tsx';
import { useSettings } from './useSettings.ts';

type Props = { onClose: () => void };

const ITEMS: { key: keyof Settings; label: string }[] = [
  { key: 'shake', label: '画面の揺れ' },
  { key: 'sfx', label: '効果音' },
  { key: 'bgm', label: 'BGM' },
];

/** 全ゲーム共通の設定。どのゲームからでも 1 タップで開く。各項目はオン / オフのラジオボタン */
export default function SettingsPanel({ onClose }: Props) {
  const s = useSettings();
  const name = useId();

  return (
    <Dialog title="設定">
      {ITEMS.map(({ key, label }, i) => (
        <fieldset key={key} className="setting">
          <legend className="setting-label">{label}</legend>
          <div className="segmented">
            {[true, false].map((on) => (
              <label key={String(on)}>
                <input
                  type="radio"
                  name={`${name}-${key}`}
                  checked={s[key] === on}
                  onChange={() => settings.update({ [key]: on })}
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
