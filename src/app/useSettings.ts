import { useSyncExternalStore } from 'react';
import { settings } from '../juice/settings.ts';
import type { Settings } from '../juice/settings.ts';

export function useSettings(): Settings {
  return useSyncExternalStore(settings.subscribe, settings.get);
}

const getReducedMotion = (): boolean => settings.reducedMotion;

/** `prefers-reduced-motion: reduce` か。変わったら描き直す */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(settings.subscribe, getReducedMotion);
}
