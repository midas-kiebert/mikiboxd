/**
 * A one-time thing the app has to tell the user about the sign-in that just
 * happened.
 *
 * There is exactly one so far: linking Apple or Google to an account whose
 * email address had never been confirmed discards that account's password (see
 * `get_or_create_social_user` on the backend). That is deliberate — the
 * provider proved who owns the mailbox, an unconfirmed password did not — but
 * it silently changes how the user signs in, and the alternative to saying so
 * is letting them find out the next time they type a password that no longer
 * works.
 *
 * Set by the sign-in, read by a host in the root layout, because the screen
 * that learns about it unmounts on the very navigation that follows.
 *
 * In memory only, like `username-gate.ts`: it belongs to the sign-in that just
 * happened, and a notice that outlived its session would be a mystery.
 *
 * Module-level store with subscribers, like `auth-session.ts` and `intro.ts`.
 */
import { useEffect, useState } from 'react';

/** Which provider was linked, so the notice can name it. */
export type LinkedProvider = 'apple' | 'google';

let pendingProvider: LinkedProvider | null = null;

const subscribers = new Set<() => void>();

const update = (next: LinkedProvider | null): void => {
  if (pendingProvider === next) return;
  pendingProvider = next;
  subscribers.forEach((notify) => notify());
};

/** The account's password was dropped to link this provider to it. */
export const markPasswordRemovedForProvider = (provider: LinkedProvider): void =>
  update(provider);

/** The user has read it. */
export const clearSignInNotice = (): void => update(null);

export const usePendingSignInNotice = (): LinkedProvider | null => {
  const [snapshot, setSnapshot] = useState(pendingProvider);

  useEffect(() => {
    const notify = () => setSnapshot(pendingProvider);
    subscribers.add(notify);
    notify();
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  return snapshot;
};
