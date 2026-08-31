/**
 * The user's Cineville card number, kept on the device only.
 *
 * The digits are stored without their `CP$` prefix — the prefix is fixed, so it
 * is added back when the number is scanned (`buildCinevilleBarcodeValue`) or
 * shown. Screens read the saved number through `useCinevilleCardDigits`, which
 * keeps them in sync when it is saved or removed elsewhere in the app: secure
 * storage cannot be watched, so saves are announced here instead.
 */
import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'cineville_card_number';

export const CINEVILLE_PREFIX = 'CP$';
export const CINEVILLE_DIGITS_LENGTH = 9;

/** `undefined` until the first read from storage comes back. */
type CachedDigits = string | null | undefined;

let cachedDigits: CachedDigits;
let pendingLoad: Promise<string | null> | null = null;
const listeners = new Set<() => void>();

const publish = (digits: string | null): void => {
  cachedDigits = digits;
  listeners.forEach((listener) => listener());
};

export const saveCinevilleCardDigits = async (digits: string): Promise<void> => {
  await SecureStore.setItemAsync(STORAGE_KEY, digits);
  publish(digits);
};

export const loadCinevilleCardDigits = async (): Promise<string | null> => {
  // Several screens can ask at once (the showtimes shortcut and settings both
  // do on mount); one read is enough, so concurrent callers share it.
  pendingLoad ??= SecureStore.getItemAsync(STORAGE_KEY)
    .then((digits) => {
      publish(digits);
      return digits;
    })
    .finally(() => {
      pendingLoad = null;
    });
  return pendingLoad;
};

export const deleteCinevilleCard = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
  publish(null);
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  if (cachedDigits === undefined) void loadCinevilleCardDigits();
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): CachedDigits => cachedDigits;

/**
 * The saved card number, or `null` when there is none. Stays `undefined` for the
 * first frame or two, while storage is read — callers that would flash an empty
 * state should render nothing until it resolves.
 */
export const useCinevilleCardDigits = (): CachedDigits =>
  useSyncExternalStore(subscribe, getSnapshot);

/** The string a Cineville scanner expects: the `CP$` prefix plus the digits. */
export const buildCinevilleBarcodeValue = (digits: string): string =>
  `${CINEVILLE_PREFIX}${digits}`;
