/**
 * "This session owes a username", known synchronously.
 *
 * The account itself is the real authority (see `hooks/useCurrentUser`), but it
 * arrives over the network, and the moment that matters is the one before it
 * does: a social sign-in announces its session and navigates to /pick-username
 * in the same block, and until the account loads, nothing else in the app can
 * tell that this brand-new session is not an ordinary one. The root layout's
 * route guard, seeing a session on a signed-out route, sent it to the tabs —
 * and the first-run intro started over the username form that never appeared.
 *
 * So the sign-in states it outright, in the same synchronous block as
 * `markSignedIn`, and the guard has an answer from the first render rather than
 * one round trip later.
 *
 * Deliberately in memory only, unlike `intro.ts`: a stored flag that outlived
 * its account (a reinstall, another device) would strand a user on the username
 * screen for good, and the account is authoritative from the next launch anyway.
 *
 * Module-level store with subscribers, like `auth-session.ts` and `intro.ts`.
 */
import { useEffect, useState } from 'react';

let isRequired = false;

const subscribers = new Set<() => void>();

const update = (next: boolean): void => {
  if (isRequired === next) return;
  isRequired = next;
  subscribers.forEach((notify) => notify());
};

/**
 * A session that has just started for an account with no username. Call this
 * *before* `markSignedIn`, so no render ever sees the session without it.
 */
export const markUsernameRequired = (): void => update(true);

/** The account has a username — it just picked one, or always had one. */
export const markUsernameResolved = (): void => update(false);

export const useIsUsernameRequired = (): boolean => {
  const [snapshot, setSnapshot] = useState(isRequired);

  useEffect(() => {
    const notify = () => setSnapshot(isRequired);
    subscribers.add(notify);
    notify();
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  return snapshot;
};
