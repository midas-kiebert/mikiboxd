/**
 * Whether pressing a ticket link for a Cineville cinema should also copy the
 * saved card code to the clipboard, so it can be pasted straight into the
 * ticketing site (see `handleOpenTicketLink` in `ShowtimeActionModal`).
 *
 * Defaults to on, matching the behavior before this was made switchable.
 */
import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'cineville_auto_copy_on_ticket_link';

const ENABLED_VALUE = '1';
const DISABLED_VALUE = '0';

let enabled = true;
let hasLoaded = false;
const listeners = new Set<() => void>();

const notify = (): void => listeners.forEach((listener) => listener());

const loadStoredPreference = async (): Promise<void> => {
  const stored = await SecureStore.getItemAsync(STORAGE_KEY).catch(() => null);
  // Only an explicit "off" overrides the default, so a key that was never
  // written (or a read that failed) leaves auto-copy on.
  enabled = stored !== DISABLED_VALUE;
  notify();
};

export const setCinevilleAutoCopyEnabled = (value: boolean): void => {
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

export const useCinevilleAutoCopyEnabled = (): boolean =>
  useSyncExternalStore(subscribe, () => enabled);

/** Non-hook read for use outside components, e.g. the ticket-link handler. */
export const isCinevilleAutoCopyEnabled = async (): Promise<boolean> => {
  if (!hasLoaded) {
    hasLoaded = true;
    await loadStoredPreference();
  }
  return enabled;
};
