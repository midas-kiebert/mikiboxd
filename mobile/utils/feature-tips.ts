/**
 * Feature tips — small dismissible cards that point at a feature the user has
 * not discovered yet (Letterboxd sync, cinema/filter presets, notification
 * permission). Only one is ever on screen at a time; see `FeatureTipsHost`.
 *
 * There are three independent ways to silence a tip:
 *  - the master switch in Settings hides all of them,
 *  - "Don't show again" permanently retires one tip id,
 *  - closing the dialog snoozes one tip for the rest of this app session.
 * The first two persist on the device (SecureStore, like the theme preference);
 * the session layer is deliberately memory-only so closing a tip is cheap.
 *
 * A snoozed tip leaves an unseen reminder in the notification centre, so a
 * suggestion the user waved away is recoverable rather than gone. Those
 * reminders are session-scoped too: after a restart the tip itself is back.
 *
 * Modelled on `theme-preference.ts`: a module-level store with subscribers, so
 * every mounted tip reacts to a change without needing a provider.
 */
import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

export type FeatureTipId =
  | 'letterboxd-username'
  | 'add-friends'
  | 'cinema-presets'
  | 'filter-presets'
  | 'notification-permission';

const FEATURE_TIP_IDS: readonly FeatureTipId[] = [
  'letterboxd-username',
  'add-friends',
  'cinema-presets',
  'filter-presets',
  'notification-permission',
];

/**
 * Development override: while a tip is still being designed, force it on screen
 * regardless of eligibility, the Settings switch and any dismissal. Set back to
 * `null` once each tip's real trigger conditions are wired up.
 */
export const FORCED_TIP_ID: FeatureTipId | null = null;

/**
 * Development override: seed the notification centre with a reminder for
 * every feature tip on load, so all the `FeatureTipNotificationRow` designs
 * can be reviewed at once instead of triggering each tip for real. Set to
 * `false` once the notification-centre rows have been checked.
 */
const SEED_ALL_TIP_NOTIFICATIONS = true;

const ENABLED_STORAGE_KEY = 'feature_tips_enabled_v1';
const DISMISSED_STORAGE_KEY = 'feature_tips_dismissed_v1';

/** A tip the user closed, now sitting in the notification centre. */
export type SnoozedTip = {
  id: FeatureTipId;
  /** When the dialog was closed, for the reminder's relative timestamp. */
  snoozedAt: string;
  seen: boolean;
};

type FeatureTipsState = {
  /** The master switch in Settings. */
  enabled: boolean;
  /** Tip ids the user pressed "Don't show again" on. */
  dismissedForever: ReadonlySet<FeatureTipId>;
  /** Tip ids closed this session; forgotten on app restart. */
  hiddenThisSession: ReadonlySet<FeatureTipId>;
  /** Reminders in the notification centre, newest first. */
  snoozedTips: readonly SnoozedTip[];
  /** Tips stay hidden until the stored state is in, so none of them flash. */
  isLoaded: boolean;
  /**
   * Set by `reopenTip`: shows that tip regardless of its real eligibility, so
   * reopening from the notification centre always works even for a tip whose
   * underlying condition is no longer (or was never really) true.
   */
  forcedTipId: FeatureTipId | null;
};

let state: FeatureTipsState = {
  enabled: true,
  dismissedForever: new Set(),
  hiddenThisSession: new Set(),
  snoozedTips: [],
  isLoaded: false,
  forcedTipId: null,
};

const subscribers = new Set<() => void>();

const update = (patch: Partial<FeatureTipsState>): void => {
  state = { ...state, ...patch };
  subscribers.forEach((notify) => notify());
};

const parseDismissed = (raw: string | null): Set<FeatureTipId> => {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    // Unknown ids are dropped, so a renamed tip doesn't stay silenced forever.
    return new Set(
      parsed.filter((id): id is FeatureTipId => FEATURE_TIP_IDS.includes(id as FeatureTipId))
    );
  } catch {
    return new Set();
  }
};

const persistDismissed = (ids: ReadonlySet<FeatureTipId>): void => {
  SecureStore.setItemAsync(DISMISSED_STORAGE_KEY, JSON.stringify([...ids])).catch(() => {});
};

/** Read the stored tip state into memory. Called once on app start. */
export const loadFeatureTips = async (): Promise<void> => {
  const [storedEnabled, storedDismissed] = await Promise.all([
    SecureStore.getItemAsync(ENABLED_STORAGE_KEY).catch(() => null),
    SecureStore.getItemAsync(DISMISSED_STORAGE_KEY).catch(() => null),
  ]);
  update({
    // Anything other than an explicit opt-out means tips are on.
    enabled: storedEnabled !== 'false',
    dismissedForever: parseDismissed(storedDismissed),
    snoozedTips: SEED_ALL_TIP_NOTIFICATIONS
      ? FEATURE_TIP_IDS.map((id) => ({ id, snoozedAt: new Date().toISOString(), seen: false }))
      : [],
    isLoaded: true,
  });
};

export const setFeatureTipsEnabled = (enabled: boolean): void => {
  update({ enabled });
  SecureStore.setItemAsync(ENABLED_STORAGE_KEY, String(enabled)).catch(() => {});
};

export const dismissTipForever = (id: FeatureTipId): void => {
  const dismissedForever = new Set(state.dismissedForever).add(id);
  update({
    dismissedForever,
    // A retired tip leaves no reminder behind.
    snoozedTips: state.snoozedTips.filter((tip) => tip.id !== id),
    forcedTipId: state.forcedTipId === id ? null : state.forcedTipId,
  });
  persistDismissed(dismissedForever);
};

/** Closing the dialog: hide the tip and leave a reminder in the bell. */
export const snoozeTip = (id: FeatureTipId): void => {
  update({
    hiddenThisSession: new Set(state.hiddenThisSession).add(id),
    snoozedTips: [
      { id, snoozedAt: new Date().toISOString(), seen: false },
      ...state.snoozedTips.filter((tip) => tip.id !== id),
    ],
    forcedTipId: state.forcedTipId === id ? null : state.forcedTipId,
  });
};

/**
 * Tapping the reminder: put the tip back on screen and drop the reminder.
 * Forces the tip open regardless of its real eligibility, since the reminder
 * may have been seeded for testing rather than earned by the real trigger.
 */
export const reopenTip = (id: FeatureTipId): void => {
  const hiddenThisSession = new Set(state.hiddenThisSession);
  hiddenThisSession.delete(id);
  update({
    hiddenThisSession,
    snoozedTips: state.snoozedTips.filter((tip) => tip.id !== id),
    forcedTipId: id,
  });
};

/** The reminder's ✕: drop the reminder, leave the tip hidden. */
export const dismissSnoozedTip = (id: FeatureTipId): void => {
  update({ snoozedTips: state.snoozedTips.filter((tip) => tip.id !== id) });
};

/** Clears the bell badge when the notification centre is opened. */
export const markSnoozedTipsSeen = (): void => {
  if (state.snoozedTips.every((tip) => tip.seen)) return;
  update({ snoozedTips: state.snoozedTips.map((tip) => ({ ...tip, seen: true })) });
};

/** Settings escape hatch: bring back every tip the user has retired. */
export const restoreDismissedTips = (): void => {
  update({
    dismissedForever: new Set(),
    hiddenThisSession: new Set(),
    snoozedTips: [],
    forcedTipId: null,
  });
  persistDismissed(new Set());
};

const useFeatureTipsState = (): FeatureTipsState => {
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

export const useFeatureTipsEnabled = (): [boolean, (enabled: boolean) => void] => {
  const { enabled } = useFeatureTipsState();
  return [enabled, setFeatureTipsEnabled];
};

export const useDismissedTipCount = (): number => useFeatureTipsState().dismissedForever.size;

export const useSnoozedTips = (): readonly SnoozedTip[] => useFeatureTipsState().snoozedTips;

export const useUnseenSnoozedTipCount = (): number =>
  useFeatureTipsState().snoozedTips.filter((tip) => !tip.seen).length;

export type FeatureTipCandidate = {
  id: FeatureTipId;
  /** Is the thing this tip nudges towards actually still undone? */
  isEligible: boolean;
};

/**
 * Picks the one tip to show, so the user is never handed a stack of nags.
 * Candidates are checked in order — pass them most-useful-first.
 */
export const useFirstVisibleTip = (
  candidates: readonly FeatureTipCandidate[]
): FeatureTipId | null => {
  const { enabled, dismissedForever, hiddenThisSession, forcedTipId, isLoaded } =
    useFeatureTipsState();

  if (!isLoaded) return null;
  // The forced tip ignores eligibility, the Settings switch and any permanent
  // dismissal, but it still honours the snooze: closing it has to actually
  // close it, and reopening from the notification centre has to bring it back.
  if (FORCED_TIP_ID) return hiddenThisSession.has(FORCED_TIP_ID) ? null : FORCED_TIP_ID;
  // Reopening a tip from the notification centre forces it open too, since the
  // reminder may not correspond to a still-true real eligibility condition.
  if (forcedTipId) return hiddenThisSession.has(forcedTipId) ? null : forcedTipId;
  if (!enabled) return null;

  const match = candidates.find(
    (candidate) =>
      candidate.isEligible &&
      !dismissedForever.has(candidate.id) &&
      !hiddenThisSession.has(candidate.id)
  );
  return match?.id ?? null;
};

/**
 * Closing handler for one tip. `dismissForever` comes from the dialog's
 * "Don't show this again" toggle: on means retired for good and no reminder,
 * off means snoozed for the session with a reminder left in the bell.
 */
export const useDismissTip = (id: FeatureTipId): ((dismissForever: boolean) => void) =>
  useCallback(
    (dismissForever: boolean) => {
      if (dismissForever) {
        dismissTipForever(id);
        return;
      }
      snoozeTip(id);
    },
    [id]
  );
