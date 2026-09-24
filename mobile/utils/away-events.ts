/**
 * What happened to the account while the app was closed: invites, friend
 * requests and interested screenings that sold out. Read each time the app
 * comes to the foreground, for the notification tips (see `EVENT_TIP_IDS` in
 * `utils/feature-tips`), which only ever speak about events from that window.
 *
 * The window starts when the app last went to the background — not when it
 * last opened — so anything that arrived while the app was on screen, and the
 * user saw it happen, never counts. The mark is stored per account, so
 * switching accounts on one device does not hand one account's absence to the
 * other. With no mark yet (first launch, or first launch of this version)
 * there is no window at all: nothing is "new since last time" on a first time.
 *
 * Module-level store with subscribers, like `feature-tips.ts`.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { type AwayEventsPublic, MeService } from 'shared/client';

const LAST_ACTIVE_STORAGE_KEY = 'app_last_active_v1';

type AwayEventsState = {
  /** Null until the first foreground's lookup has come back. */
  events: AwayEventsPublic | null;
  /** Increments per foreground, so a consumer can react to each new window. */
  windowId: number;
};

const NO_EVENTS: AwayEventsPublic = {
  upcoming_invites: [],
  missed_invites: [],
  friend_requests: 0,
  sold_out: [],
};

let state: AwayEventsState = { events: null, windowId: 0 };
const subscribers = new Set<() => void>();

const update = (patch: Partial<AwayEventsState>): void => {
  state = { ...state, ...patch };
  subscribers.forEach((notify) => notify());
};

const storageKey = (userId: string): string => `${LAST_ACTIVE_STORAGE_KEY}.${userId}`;

const markActive = (userId: string): void => {
  SecureStore.setItemAsync(storageKey(userId), new Date().toISOString()).catch(() => {});
};

/** Look up the window since the stored mark, then move the mark to now. */
const openWindow = async (userId: string): Promise<void> => {
  const since = await SecureStore.getItemAsync(storageKey(userId)).catch(() => null);
  markActive(userId);
  let events = NO_EVENTS;
  if (since) {
    try {
      events = await MeService.getAwayEvents({ since });
    } catch (error) {
      // A failed lookup is a window with nothing in it: the tips are a nicety.
      console.error('Error reading events since the app was last open:', error);
    }
  }
  update({ events, windowId: state.windowId + 1 });
};

/**
 * Track foreground/background for `userId` while mounted. Mount once, where
 * the signed-in app lives.
 */
export const useAwayEventsTracking = (userId: string | null): void => {
  useEffect(() => {
    if (!userId) return;
    void openWindow(userId);
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active') void openWindow(userId);
      if (next !== 'active' && previous === 'active') markActive(userId);
      previous = next;
    });
    return () => {
      subscription.remove();
      markActive(userId);
    };
  }, [userId]);
};

export const useAwayEvents = (): AwayEventsState => {
  const [snapshot, setSnapshot] = useState(state);

  useEffect(() => {
    const notify = () => setSnapshot(state);
    subscribers.add(notify);
    notify();
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  return snapshot;
};
