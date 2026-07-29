/**
 * Whether the app shell is up and the launch splash is gone.
 *
 * Deep links need this. A link handled during launch runs against a shell that
 * is still assembling: the navigator may be in its very first commit (where
 * `router.replace` throws), and the showtime sheet's portal fixes its stacking
 * at the first present — so a sheet raised while the splash overlay is still
 * painted ends up in the wrong layer for the rest of the session. Both are
 * avoided by holding the link until this flips.
 *
 * Module-level store with subscribers, like `auth-session.ts` and `intro.ts`,
 * so it can be read from anywhere without threading another provider through.
 */
import { useEffect, useState } from "react";

let ready = false;

const subscribers = new Set<() => void>();

/** Announce that the shell is up — called once, as the splash finishes fading. */
export const markAppReady = (): void => {
  if (ready) return;
  ready = true;
  subscribers.forEach((notify) => notify());
};

export const useIsAppReady = (): boolean => {
  const [snapshot, setSnapshot] = useState(ready);

  useEffect(() => {
    const notify = () => setSnapshot(ready);
    subscribers.add(notify);
    // The splash can finish between this component's render and its subscribe.
    notify();
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  return snapshot;
};
