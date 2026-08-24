/**
 * Whether the Cineville pass shortcut is shown on the agenda and the showtimes
 * feeds, chosen per surface in Settings and stored on the device next to the
 * card number itself ([[cineville-card]]).
 *
 * Both default to on: someone who has saved a card number is exactly the person
 * who wants the shortcut, and a button that has to be switched on before it can
 * be found would never be found. Turning one off is for people who would rather
 * keep a feed clear.
 */
import { useCallback, useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';

export type CinevilleShortcutSurface = 'agenda' | 'showtimes';

const STORAGE_KEYS: Record<CinevilleShortcutSurface, string> = {
  agenda: 'cineville_shortcut_agenda',
  showtimes: 'cineville_shortcut_showtimes',
};

/** Stored as a flag rather than JSON — this is one boolean per surface. */
const ENABLED_VALUE = '1';
const DISABLED_VALUE = '0';

const enabledBySurface: Record<CinevilleShortcutSurface, boolean> = {
  agenda: true,
  showtimes: true,
};

let hasLoaded = false;
const listeners = new Set<() => void>();

const notify = (): void => listeners.forEach((listener) => listener());

const loadStoredPreferences = async (): Promise<void> => {
  const surfaces = Object.keys(STORAGE_KEYS) as CinevilleShortcutSurface[];
  const stored = await Promise.all(
    surfaces.map((surface) => SecureStore.getItemAsync(STORAGE_KEYS[surface]).catch(() => null))
  );
  // Only an explicit "off" overrides the default, so a key that was never
  // written (or a read that failed) leaves the shortcut visible.
  surfaces.forEach((surface, index) => {
    enabledBySurface[surface] = stored[index] !== DISABLED_VALUE;
  });
  notify();
};

export const setCinevilleShortcutEnabled = (
  surface: CinevilleShortcutSurface,
  enabled: boolean
): void => {
  // Painted first, persisted after: a switch that waits for secure storage
  // before it moves reads as broken.
  enabledBySurface[surface] = enabled;
  notify();
  SecureStore.setItemAsync(
    STORAGE_KEYS[surface],
    enabled ? ENABLED_VALUE : DISABLED_VALUE
  ).catch(() => {});
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  if (!hasLoaded) {
    hasLoaded = true;
    void loadStoredPreferences();
  }
  return () => {
    listeners.delete(listener);
  };
};

/** Whether the pass shortcut should be shown on `surface`. */
export const useCinevilleShortcutEnabled = (surface: CinevilleShortcutSurface): boolean =>
  useSyncExternalStore(
    subscribe,
    useCallback(() => enabledBySurface[surface], [surface])
  );
