/**
 * First-run intro — the full-screen tour a brand-new account walks through once,
 * covering the things the app is useless without (favorite cinemas, the
 * Letterboxd link, what the showtime sheet's buttons do, friends, and turning
 * notifications on) and finishing with a nudge towards the filters.
 *
 * Related to feature tips but deliberately separate: a tip is a single
 * dismissible nudge that appears at random long after the user has settled in,
 * while this is one blocking, ordered walkthrough shown exactly once. It does
 * retire the tips it makes redundant as it goes (see `IntroLetterboxdPage` and
 * `retireCinemaPresetTip`), so the user is never told twice.
 *
 * Who sees it: only an account created on this device. `markIntroPending` is
 * called the moment an account is created (email signup, or a social sign-in
 * the backend reports as new), and the flag survives the trip through the login
 * screen in SecureStore. Existing users updating the app therefore never get an
 * intro for an app they already know.
 *
 * The pending flag is cleared when the walkthrough is skipped or reaches its
 * last page, not when it starts: an app killed halfway through has not actually
 * been introduced to anything, so it gets another go on the next launch.
 *
 * Module-level store with subscribers, like `theme-preference.ts` and
 * `feature-tips.ts`, so the host, the showtimes screen and the tips host all
 * react to a phase change without a provider.
 */
import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

/** The full-screen pages, in the order they are shown. */
export type IntroPageId =
  | 'cinemas'
  | 'letterboxd'
  | 'showtime-tour'
  | 'friends'
  | 'notifications';

export const INTRO_PAGE_ORDER: readonly IntroPageId[] = [
  'cinemas',
  'letterboxd',
  'showtime-tour',
  'friends',
  // Last: it triggers the OS permission dialog by itself, and a system prompt
  // landing over the middle of the walkthrough would interrupt it.
  'notifications',
];

/**
 * Where the intro is right now.
 *  - `idle`: not running (never started, or finished/skipped).
 *  - `pages`: the blocking full-screen walkthrough is on screen.
 *  - `filters-spotlight`: the pages are done and the showtimes screen owes the
 *    user one highlight over its Filters button, as soon as its list has loaded.
 */
export type IntroPhase = 'idle' | 'pages' | 'filters-spotlight';

const PENDING_STORAGE_KEY = 'intro_pending_v1';

/**
 * How long the showtimes screen gets to deliver the final highlight before the
 * intro stops waiting for it.
 *
 * Without this the `filters-spotlight` phase could last the whole session: the
 * screen only mounts the highlight once its feed has actually loaded, is
 * focused and has nothing open over it, and a user who lands on an empty feed
 * or goes straight to another tab never satisfies that. The intro then still
 * counts as running, which — among other things — keeps every feature tip
 * suppressed (see `FeatureTipsHost`) until the app is restarted.
 */
const FILTERS_SPOTLIGHT_DEADLINE_MS = 3 * 60 * 1000;

let spotlightDeadlineTimer: ReturnType<typeof setTimeout> | null = null;

const clearSpotlightDeadline = (): void => {
  if (spotlightDeadlineTimer === null) return;
  clearTimeout(spotlightDeadlineTimer);
  spotlightDeadlineTimer = null;
};

type IntroState = {
  phase: IntroPhase;
  /** An account was created on this device and has not been introduced yet. */
  isPending: boolean;
  /** Nothing starts until the stored flag is in, so the intro never flashes. */
  isLoaded: boolean;
};

let state: IntroState = {
  phase: 'idle',
  isPending: false,
  isLoaded: false,
};

const subscribers = new Set<() => void>();

const update = (patch: Partial<IntroState>): void => {
  state = { ...state, ...patch };
  subscribers.forEach((notify) => notify());
};

const persistPending = (isPending: boolean): void => {
  if (isPending) {
    SecureStore.setItemAsync(PENDING_STORAGE_KEY, '1').catch(() => {});
    return;
  }
  SecureStore.deleteItemAsync(PENDING_STORAGE_KEY).catch(() => {});
};

/** Read the stored pending flag into memory. Called once on app start. */
export const loadIntroState = async (): Promise<void> => {
  const stored = await SecureStore.getItemAsync(PENDING_STORAGE_KEY).catch(() => null);
  update({ isPending: stored === '1', isLoaded: true });
};

/**
 * An account was just created on this device. Called from the signup screens
 * rather than from `completeLogin`, which every returning user passes through
 * too.
 */
export const markIntroPending = (): void => {
  update({ isPending: true });
  persistPending(true);
};

/**
 * Start the intro if this device just created an account. Safe to call on every
 * render: a no-op once the intro is running, and once it has been dealt with.
 * Returns whether it actually started, so a caller that also needs to land the
 * user on a known screen before the walkthrough begins knows when to bother.
 */
export const startIntroIfPending = (): boolean => {
  if (!state.isLoaded || !state.isPending || state.phase !== 'idle') return false;
  update({ phase: 'pages' });
  return true;
};

/** Developer override: replay the intro from the Settings screen. */
export const startIntro = (): void => {
  // A replay started while a previous run's spotlight deadline is still
  // pending would otherwise be cut short by it.
  clearSpotlightDeadline();
  update({ phase: 'pages' });
};

/**
 * The four pages are done; the showtimes screen still owes the last highlight.
 *
 * The pending flag is cleared here rather than at the very end: the highlight
 * waits for a clear showtimes screen and might never get one this session, and
 * replaying the whole walkthrough over a single missed highlight is far worse
 * than losing the highlight.
 */
export const completeIntroPages = (): void => {
  update({ phase: 'filters-spotlight', isPending: false });
  persistPending(false);
  clearSpotlightDeadline();
  spotlightDeadlineTimer = setTimeout(endIntro, FILTERS_SPOTLIGHT_DEADLINE_MS);
};

/**
 * The filters highlight is on screen, so the deadline above has done its job:
 * from here the step ends itself, whether the user takes the suggestion, just
 * acknowledges it, or the button turns out not to be measurable.
 */
export const markFiltersSpotlightStarted = (): void => {
  clearSpotlightDeadline();
};

/** The whole intro is over — either finished or skipped. */
export const endIntro = (): void => {
  clearSpotlightDeadline();
  update({ phase: 'idle', isPending: false });
  persistPending(false);
};

const useIntroState = (): IntroState => {
  const [snapshot, setSnapshot] = useState(state);

  useEffect(() => {
    const notify = () => setSnapshot(state);
    subscribers.add(notify);
    // The initial load can land between this component's render and subscribe.
    notify();
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  return snapshot;
};

export const useIntroPhase = (): IntroPhase => useIntroState().phase;

/** False until the stored pending flag is in, so nothing starts too early. */
export const useIsIntroLoaded = (): boolean => useIntroState().isLoaded;

/**
 * True while any part of the intro is still owed, including the final filters
 * highlight. Feature tips stay out of the way until this is false.
 */
export const useIsIntroActive = (): boolean => useIntroState().phase !== 'idle';

/**
 * True from the moment an account is marked for the intro until the whole
 * thing — pages and the final filters highlight both — is done. Unlike
 * `useIsIntroActive`, this also covers the brief window right after signup
 * where `isPending` is set but `IntroHost` hasn't flipped the phase to
 * `pages` yet, which matters for anything that has to wait for the intro to
 * be entirely out of the way before it does its own first thing (e.g. asking
 * for notification permission).
 */
export const isIntroOwed = (): boolean => state.isPending || state.phase !== 'idle';

export const useIsIntroOwed = (): boolean => {
  const introState = useIntroState();
  return introState.isPending || introState.phase !== 'idle';
};
