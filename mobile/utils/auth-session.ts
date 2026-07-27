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
 * `unknown` only until the stored token has been read once at startup; the app
 * shell stays behind the splash for as long as it lasts.
 */
export type AuthStatus = 'unknown' | 'signed-in' | 'signed-out';

let status: AuthStatus = 'unknown';

const subscribers = new Set<() => void>();

const setStatus = (next: AuthStatus): void => {
  if (status === next) return;
  status = next;
  subscribers.forEach((notify) => notify());
};

/**
 * Read the stored token once, at app start. A sign-in that somehow beat this
 * read wins: the token it just wrote is newer than whatever was on disk when
 * this started.
 */
export const loadAuthSession = async (): Promise<void> => {
  const token = await storage.getItem('access_token').catch(() => null);
  if (status !== 'unknown') return;
  setStatus(token ? 'signed-in' : 'signed-out');
};

/**
 * Announce a session that has just started. Call this *immediately before*
 * navigating into the app, in the same synchronous block, so React batches the
 * two together and the route guard never sees one without the other.
 */
export const markSignedIn = (): void => setStatus('signed-in');

/** Announce a session that has just ended — logout, or a refresh that failed. */
export const markSignedOut = (): void => setStatus('signed-out');

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
