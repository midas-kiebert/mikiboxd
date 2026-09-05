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
import { useSyncExternalStore } from 'react';
import { Appearance, InteractionManager, type ColorSchemeName } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type ThemePreference = 'light' | 'dark' | 'system';
export type Scheme = 'light' | 'dark';

/**
 * A system colour scheme narrowed to one the app can actually paint.
 *
 * `Appearance` does not only answer 'light' or 'dark': it reports `null` while
 * the app is being restored or backgrounded, and its type also admits
 * 'unspecified'. Neither is a colour, so both fall back to whatever was last
 * known good rather than to a guess.
 */
export const toScheme = (
  value: ColorSchemeName | null | undefined,
  fallback: Scheme
): Scheme =>
  value === 'light' || value === 'dark' ? value : fallback;

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

/**
 * Announces a change to one subscriber list, over a copy of it.
 *
 * `Set.forEach` walks the live set, and a listener may subscribe or unsubscribe
 * as a *side effect* of being called — React unmounting the component that owns
 * it, most obviously, since re-theming re-renders the whole app. A listener
 * deleted before the walk reaches it is then never called, and there is no
 * second announcement: the value has already moved, so it stays missed. That is
 * a tear, and this store is read twice by the same component often enough to
 * see one — `SegmentedControl` reads the palette through `useColorScheme`
 * while its caller reads the preference directly, so a miss on either side left
 * the control painting one theme's selection in the other theme's colours.
 */
const announce = (listeners: Set<() => void>) => {
  for (const listener of [...listeners]) listener();
};

const notify = () => announce(subscribers);
const notifySwitching = () => announce(switchSubscribers);

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
  if (preference === 'system') return toScheme(Appearance.getColorScheme(), 'dark');
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

const subscribe = (onStoreChange: () => void) => {
  subscribers.add(onStoreChange);
  return () => {
    subscribers.delete(onStoreChange);
  };
};

const subscribeSwitching = (onStoreChange: () => void) => {
  switchSubscribers.add(onStoreChange);
  return () => {
    switchSubscribers.delete(onStoreChange);
  };
};

const getIsSwitching = (): boolean => switchingTo !== null;

/**
 * The current preference, and the setter that changes it.
 *
 * `useSyncExternalStore` rather than a `useState` copy kept in step by hand.
 * The copy was wrong in two ways that both showed up as wrong colours: it was
 * seeded a render before the subscription was added, so a component mounting
 * while `loadThemePreference` announced the stored value kept the *default*
 * theme for life; and every reader held its own copy, so two readers that
 * disagreed stayed disagreeing, because a preference is only ever announced
 * once. React re-reads this snapshot on every render and guarantees one value
 * across a commit, so neither is expressible.
 */
export const useThemePreference = (): [ThemePreference, (p: ThemePreference) => void] => [
  useSyncExternalStore(subscribe, getThemePreference),
  setThemePreference,
];

/** True from the tap until the app has finished wearing the new theme. */
export const useIsThemeSwitching = (): boolean =>
  useSyncExternalStore(subscribeSwitching, getIsSwitching);
