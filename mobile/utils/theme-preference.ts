import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme_preference';
const DEFAULT_PREFERENCE: ThemePreference = 'dark';

let current: ThemePreference = DEFAULT_PREFERENCE;
const subscribers = new Set<() => void>();

const notify = () => subscribers.forEach((fn) => fn());

export const getThemePreference = (): ThemePreference => current;

export const setThemePreference = (preference: ThemePreference): void => {
  current = preference;
  notify();
  SecureStore.setItemAsync(STORAGE_KEY, preference).catch(() => {});
};

export const loadThemePreference = async (): Promise<void> => {
  const stored = await SecureStore.getItemAsync(STORAGE_KEY).catch(() => null);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    current = stored;
    notify();
  }
};

export const useThemePreference = (): [ThemePreference, (p: ThemePreference) => void] => {
  const [preference, setPreference] = useState<ThemePreference>(current);

  useEffect(() => {
    const update = () => setPreference(current);
    subscribers.add(update);
    return () => {
      subscribers.delete(update);
    };
  }, []);

  return [preference, setThemePreference];
};
