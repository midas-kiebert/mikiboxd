/**
 * A guest's chosen cinemas, kept on the device.
 *
 * A signed-in user's picks live on their account, which is what makes them
 * follow them between devices. A guest has no account to put them on, but the
 * choice is no less theirs for that: someone who narrows the feed to the four
 * cinemas they actually go to should not have to do it again after every
 * relaunch. So it is stored locally, and handed to the same session-filter
 * state the account's saved picks feed into — from the feed's point of view
 * there is one source of "which cinemas", and only its origin differs.
 *
 * Empty means "all cinemas", which is also where a guest starts: they have
 * expressed no preference yet, and the honest answer to that is everything
 * that's on rather than nothing.
 *
 * Kept if they later sign up (see `claimGuestCinemaSelection`), because the
 * work of picking is the same work either way.
 *
 * Module-level store with subscribers, like `theme-preference.ts` and
 * `auth-session.ts`, read once at startup.
 */
import { useEffect, useState } from "react";
import { storage } from "shared/storage";

const GUEST_CINEMA_SELECTION_KEY = "guest_cinema_selection";

/** undefined until the stored value has been read once, at startup. */
let selection: number[] | undefined;

const subscribers = new Set<() => void>();

const notify = (): void => {
  subscribers.forEach((subscriber) => subscriber());
};

const parseStoredSelection = (raw: string | null): number[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is number => typeof id === "number");
  } catch {
    return [];
  }
};

/** Read the stored picks once, at app start. */
export const loadGuestCinemaSelection = async (): Promise<void> => {
  const raw = await storage.getItem(GUEST_CINEMA_SELECTION_KEY).catch(() => null);
  if (selection !== undefined) return;
  selection = parseStoredSelection(raw);
  notify();
};

/** Replace the guest's picks. An empty list means "all cinemas". */
export const saveGuestCinemaSelection = (cinemaIds: readonly number[]): void => {
  selection = [...cinemaIds];
  void storage.setItem(GUEST_CINEMA_SELECTION_KEY, JSON.stringify(selection));
  notify();
};

/**
 * Hand the guest's picks over to the account they just made, and forget them
 * here. Returns what was stored so the caller can save it server-side; an
 * empty list means there was nothing to carry over.
 */
export const claimGuestCinemaSelection = (): number[] => {
  const claimed = selection ?? [];
  selection = [];
  void storage.removeItem(GUEST_CINEMA_SELECTION_KEY);
  notify();
  return claimed;
};

/**
 * The guest's picks, or undefined while the startup read is still in flight —
 * the same "not known yet" the account-backed selection query reports, so the
 * feed's seeding logic can treat the two identically.
 */
export const useGuestCinemaSelection = (): number[] | undefined => {
  const [snapshot, setSnapshot] = useState(selection);

  useEffect(() => {
    const subscriber = () => setSnapshot(selection);
    subscribers.add(subscriber);
    // The startup read can land between this component's render and subscribe.
    subscriber();
    return () => {
      subscribers.delete(subscriber);
    };
  }, []);

  return snapshot;
};
