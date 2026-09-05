/**
 * Whether marking a showtime "going" should prompt to clear "interested" left
 * on other showtimes of the same movie (see `RemoveInterestedElsewhereDialog`,
 * wired up in `ShowtimeActionModal`).
 *
 * Defaults to on; the dialog itself offers a "don't ask again" checkbox that
 * flips this off.
 */
import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'remind_remove_interested_elsewhere';

const ENABLED_VALUE = '1';
const DISABLED_VALUE = '0';

let enabled = true;
let hasLoaded = false;
const listeners = new Set<() => void>();

const notify = (): void => listeners.forEach((listener) => listener());

const loadStoredPreference = async (): Promise<void> => {
  const stored = await SecureStore.getItemAsync(STORAGE_KEY).catch(() => null);
  // Only an explicit "off" overrides the default, so a key that was never
  // written (or a read that failed) leaves the reminder on.
  enabled = stored !== DISABLED_VALUE;
  notify();
};

export const setRemoveInterestedReminderEnabled = (value: boolean): void => {
  // Painted first, persisted after: a switch that waits for secure storage
  // before it moves reads as broken.
  enabled = value;
  notify();
  SecureStore.setItemAsync(STORAGE_KEY, value ? ENABLED_VALUE : DISABLED_VALUE).catch(() => {});
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  if (!hasLoaded) {
    hasLoaded = true;
    void loadStoredPreference();
  }
  return () => {
    listeners.delete(listener);
  };
};

export const useRemoveInterestedReminderEnabled = (): boolean =>
  useSyncExternalStore(subscribe, () => enabled);

/** Non-hook read for use outside components, e.g. the status-press handler. */
export const isRemoveInterestedReminderEnabled = async (): Promise<boolean> => {
  if (!hasLoaded) {
    hasLoaded = true;
    await loadStoredPreference();
  }
  return enabled;
};
