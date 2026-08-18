/**
 * Whether there is a signed-in session, as the app's navigation sees it.
 *
 * The root layout redirects between the auth screens and the tabs from this,
 * which is exactly why it cannot be re-derived from SecureStore on every route
 * change: reading the token is asynchronous, so a screen that had just signed in
 * and navigated to `/(tabs)` was still "unauthenticated" for a frame or two, and
 * the guard bounced it back to `/login` before the read landed and sent it to
 * `/(tabs)` again. That double redirect was visible as a login that hung for a
 * moment, flashed the wrong screen, and only then settled.
 *
 * So the token read happens exactly once, at startup, and every transition after
 * that is announced synchronously by whoever caused it — `completeLogin` on the
 * way in, `logout`/a 401 on the way out. The guard therefore always sees the
 * same state as the navigation it is guarding, and never fires a correcting
 * redirect.
 *
 * Module-level store with subscribers, like `theme-preference.ts` and
 * `intro.ts`, so the root layout reacts without a provider and non-React code
 * (the API error interceptors) can write to it.
 */
import { useEffect, useState } from 'react';
import { storage } from 'shared/storage';

/**
 * Three real states, not two.
 *
 * `guest` is someone who chose to look around without an account. What is
 * playing, where, and when is public — it is the same for everyone and needs no
 * account to be useful — so a guest gets all of it. What they don't get is
 * anything about themselves or their friends, which is what an account is for.
 * See `useIsSignedIn` below, which is what feature code should ask.
 *
 * `signed-out` is the other thing entirely: nobody has said what they want yet,
 * so the app opens on the door rather than inside.
 *
 * `unknown` lasts only until the stored session has been read once at startup;
 * the app shell stays behind the splash for as long as it does.
 */
export type AuthStatus = 'unknown' | 'signed-in' | 'guest' | 'signed-out';

/**
 * Set when the user chooses to browse without an account, so a relaunch puts
 * them back where they were rather than at the door they already walked past.
 */
const GUEST_MODE_KEY = 'browsing_as_guest';

let status: AuthStatus = 'unknown';

const subscribers = new Set<() => void>();

const setStatus = (next: AuthStatus): void => {
  if (status === next) return;
  status = next;
  subscribers.forEach((notify) => notify());
};

/**
 * Read the stored session once, at app start. A sign-in that somehow beat this
 * read wins: the token it just wrote is newer than whatever was on disk when
 * this started.
 */
export const loadAuthSession = async (): Promise<void> => {
  const token = await storage.getItem('access_token').catch(() => null);
  if (token) {
    if (status !== 'unknown') return;
    setStatus('signed-in');
    return;
  }
  const wasBrowsingAsGuest = await storage.getItem(GUEST_MODE_KEY).catch(() => null);
  if (status !== 'unknown') return;
  setStatus(wasBrowsingAsGuest ? 'guest' : 'signed-out');
};

/**
 * Announce a session that has just started. Call this *immediately before*
 * navigating into the app, in the same synchronous block, so React batches the
 * two together and the route guard never sees one without the other.
 */
export const markSignedIn = (): void => {
  // The guest flag only ever decides where a *sessionless* launch lands, and
  // this device now has a session. Left behind, it would quietly send a later
  // logout into the tabs instead of to the login screen.
  void storage.removeItem(GUEST_MODE_KEY);
  setStatus('signed-in');
};

/** Announce a session that has just ended — logout, or a refresh that failed. */
export const markSignedOut = (): void => {
  // A guest has no session to lose. This is reached from the API error path,
  // where the 401 that triggered it means "that endpoint needs an account", not
  // "your account is gone" — ejecting them to the login screen mid-browse would
  // be the app punishing them for tapping something it should have gated.
  if (status === 'guest') return;
  void storage.removeItem(GUEST_MODE_KEY);
  setStatus('signed-out');
};

/** Announce that the user chose to look around without an account. */
export const enterGuestMode = (): void => {
  void storage.setItem(GUEST_MODE_KEY, '1');
  setStatus('guest');
};

export const useAuthStatus = (): AuthStatus => {
  const [snapshot, setSnapshot] = useState(status);

  useEffect(() => {
    const notify = () => setSnapshot(status);
    subscribers.add(notify);
    // The startup read can land between this component's render and subscribe.
    notify();
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  return snapshot;
};

/**
 * Whether there is an account behind the current session — the question almost
 * every feature actually wants to ask. Guests are browsing, not signed in, so
 * anything that writes to an account, or reads one, must gate on this rather
 * than on "are we past the login screen".
 */
export const useIsSignedIn = (): boolean => useAuthStatus() === 'signed-in';

/** Whether the user is looking around without an account. */
export const useIsGuest = (): boolean => useAuthStatus() === 'guest';
