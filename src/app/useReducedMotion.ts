import { useSyncExternalStore } from 'react';
import { motionPreference } from '../juice/motion-preference.ts';

/** `prefers-reduced-motion: reduce` か。変わったら描き直す */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(motionPreference.subscribe, motionPreference.getReduced);
}
