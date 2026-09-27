type VibrationNavigator = Navigator & { userActivation?: { readonly hasBeenActive: boolean } };

/** Vibration API が使える環境の navigator（Android Chrome など。iOS Safari には無い）。使えなければ null */
function vibrationNavigator(): VibrationNavigator | null {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return null;
  return navigator as VibrationNavigator;
}

/**
 * 振動させる。どこから呼んでもよく、未対応の環境や、まだユーザーが一度も操作していない
 * （ブラウザが振動を拒否する）場面では何もしない。
 */
export function vibrate(pattern: number | readonly number[]): void {
  const nav = vibrationNavigator();
  if (!nav) return;
  if (nav.userActivation && !nav.userActivation.hasBeenActive) return;
  try {
    nav.vibrate(typeof pattern === 'number' ? pattern : [...pattern]);
  } catch {
    // ブラウザが拒否する場面では黙って諦める
  }
}
