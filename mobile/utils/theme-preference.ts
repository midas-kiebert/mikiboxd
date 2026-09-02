/**
 * The app's theme preference, and the curtain that covers a change of it.
 *
 * Re-theming re-renders every mounted screen with a different palette, which on
 * a loaded feed takes long enough to be seen happening — rows recolouring in
 * waves, the tab bar arriving last. So a change is played in three beats rather
 * than one: the curtain comes down (`ThemeSwitchOverlay` watches
 * `useIsThemeSwitching`), the preference is applied underneath it, and the
 * curtain lifts once the app has settled again.
 *
 * The preference and the switching flag are announced on separate subscriber
 * lists, deliberately: the flag must reach one component and re-render nothing
 * else, or announcing it would cost the same full-app render it exists to hide.
 *
 * `loadThemePreference` skips all of it: at startup the native splash is still
 * up, and there is nothing on screen to cover.
 */
import { useEffect, useState } from 'react';
import { Appearance, InteractionManager } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type ThemePreference = 'light' | 'dark' | 'system';
type Scheme = 'light' | 'dark';

const STORAGE_KEY = 'theme_preference';
const DEFAULT_PREFERENCE: ThemePreference = 'dark';

/** How long the curtain takes to come down, before the re-theme starts under it. */
export const THEME_SWITCH_FADE_IN_MS = 120;
/** How long it takes to lift once the app has settled. */
export const THEME_SWITCH_FADE_OUT_MS = 240;
/**
 * Shortest time the curtain stays fully down. A device fast enough to re-theme
 * in two frames should not answer the tap with a flicker.
 */
const MIN_COVER_MS = 300;
/**
 * Longest the curtain waits for the app to report itself idle. "Settled" is not
 * something React Native will tell us exactly, so this is the backstop: if the
 * app is still busy after this, the curtain lifts and the user watches the tail
 * of the work rather than a curtain that will not go away.
 */
const SETTLE_CAP_MS = 1500;

let current: ThemePreference = DEFAULT_PREFERENCE;
/** The preference a switch is on its way to, or null when none is in flight. */
let switchingTo: ThemePreference | null = null;

const subscribers = new Set<() => void>();
const switchSubscribers = new Set<() => void>();

const notify = () => subscribers.forEach((fn) => fn());
const notifySwitching = () => switchSubscribers.forEach((fn) => fn());

let applyTimer: ReturnType<typeof setTimeout> | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let capTimer: ReturnType<typeof setTimeout> | null = null;

const clearTimers = () => {
  for (const timer of [applyTimer, settleTimer, capTimer]) {
    if (timer !== null) clearTimeout(timer);
  }
  applyTimer = null;
  settleTimer = null;
  capTimer = null;
};

export const getThemePreference = (): ThemePreference => current;

/**
 * The scheme the app is switching to — what the curtain paints itself in, so it
 * lifts onto a screen the same colour it was.
 */
export const getPendingScheme = (): Scheme => {
  const preference = switchingTo ?? current;
  if (preference === 'system') return Appearance.getColorScheme() ?? 'dark';
  return preference;
};

const finishSwitch = () => {
  clearTimers();
  if (switchingTo === null) return;
  switchingTo = null;
  notifySwitching();
};

const applyPendingPreference = () => {
  applyTimer = null;
  if (switchingTo === null) return;
  current = switchingTo;
  // The expensive one: every mounted screen re-renders, under the curtain.
  notify();

  const appliedAt = Date.now();
  const lift = () => {
    if (switchingTo === null) return;
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(finishSwitch, Math.max(0, MIN_COVER_MS - (Date.now() - appliedAt)));
  };

  // Whichever comes first: the app reporting itself idle, or the backstop.
  // `runAfterInteractions` waits for the work that render queued to drain, and
  // the frame after that is the first one the new palette is actually on.
  capTimer = setTimeout(lift, SETTLE_CAP_MS);
  InteractionManager.runAfterInteractions(() => requestAnimationFrame(lift));
};

export const setThemePreference = (preference: ThemePreference): void => {
  if (preference === (switchingTo ?? current)) return;
  SecureStore.setItemAsync(STORAGE_KEY, preference).catch(() => {});
  clearTimers();
  switchingTo = preference;
  notifySwitching();
  // Applied on a timer rather than in this tick: the curtain has to be down
  // before the render it is there to hide begins.
  applyTimer = setTimeout(applyPendingPreference, THEME_SWITCH_FADE_IN_MS);
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

/** True from the tap until the app has finished wearing the new theme. */
export const useIsThemeSwitching = (): boolean => {
  const [isSwitching, setIsSwitching] = useState(switchingTo !== null);

  useEffect(() => {
    const update = () => setIsSwitching(switchingTo !== null);
    switchSubscribers.add(update);
    update();
    return () => {
      switchSubscribers.delete(update);
    };
  }, []);

  return isSwitching;
};
