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
 * On top of dismissal, `rollForFeatureTip` caps *how often* a tip can appear
 * at all: at most one attempt per app session, gated by a per-tip cooldown
 * (`TIP_COOLDOWN_MS`, persisted) and a random chance (`TIP_SHOW_CHANCE`), so
 * even an eligible, undismissed tip does not nag on every single open.
 *
 * Modelled on `theme-preference.ts`: a module-level store with subscribers, so
 * every mounted tip reacts to a change without needing a provider.
 */
import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { MeService } from 'shared';

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
const SEED_ALL_TIP_NOTIFICATIONS = false;

const ENABLED_STORAGE_KEY = 'feature_tips_enabled_v1';
const DISMISSED_STORAGE_KEY = 'feature_tips_dismissed_v1';
const LAST_SHOWN_STORAGE_KEY = 'feature_tips_last_shown_v1';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * ONE_DAY_MS;

/**
 * Minimum time between two showings of the same tip, so a snoozed tip does not
 * simply reappear on the very next app open. Letterboxd and filter presets get
 * a longer cooldown: both are low-urgency, easy-to-ignore nudges compared to
 * friends/cinemas/notifications, so they earn the user's attention less often.
 */
const TIP_COOLDOWN_MS: Record<FeatureTipId, number> = {
  'cinema-presets': ONE_DAY_MS,
  'add-friends': ONE_DAY_MS,
  'notification-permission': ONE_DAY_MS,
  'letterboxd-username': THREE_DAYS_MS,
  'filter-presets': THREE_DAYS_MS,
};

/**
 * Even when a tip is eligible and off cooldown, it only actually appears this
 * often — so opening the app doesn't reliably nag the user every single time.
 */
const TIP_SHOW_CHANCE = 0.2;

/** How the user responded once a tip was actually shown. */
export type TipReaction = 'dismissed' | 'dont_show_again' | 'interacted';

/**
 * Best-effort usage analytics for tips: how often each one is actually shown,
 * and what the user did with it. Never allowed to affect the tip itself, so
 * failures are swallowed rather than surfaced.
 */
const trackTipShown = (id: FeatureTipId): void => {
  MeService.recordEvent({
    requestBody: { name: 'tip_shown', properties: { tip_id: id } },
  }).catch(() => {});
};

export const trackTipReaction = (id: FeatureTipId, reaction: TipReaction): void => {
  MeService.recordEvent({
    requestBody: { name: 'tip_reacted', properties: { tip_id: id, reaction } },
  }).catch(() => {});
};

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
  /** When each tip last actually appeared on screen, for the cooldown. */
  lastShownAt: Partial<Record<FeatureTipId, number>>;
  /**
   * The app makes at most one attempt to surface a tip per session. `rollDone`
   * flips true the moment that attempt happens (win or lose); `activeTipId` is
   * which tip, if any, actually won the roll and should stay on screen.
   */
  rollDone: boolean;
  activeTipId: FeatureTipId | null;
};

let state: FeatureTipsState = {
  enabled: true,
  dismissedForever: new Set(),
  hiddenThisSession: new Set(),
  snoozedTips: [],
  isLoaded: false,
  forcedTipId: null,
  lastShownAt: {},
  rollDone: false,
  activeTipId: null,
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

const parseLastShownAt = (raw: string | null): Partial<Record<FeatureTipId, number>> => {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [FeatureTipId, number] =>
        FEATURE_TIP_IDS.includes(entry[0] as FeatureTipId) && typeof entry[1] === 'number'
    );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
};

const persistLastShownAt = (lastShownAt: Partial<Record<FeatureTipId, number>>): void => {
  SecureStore.setItemAsync(LAST_SHOWN_STORAGE_KEY, JSON.stringify(lastShownAt)).catch(() => {});
};

const isInCooldown = (id: FeatureTipId): boolean => {
  const lastShown = state.lastShownAt[id];
  return lastShown !== undefined && Date.now() - lastShown < TIP_COOLDOWN_MS[id];
};

/** Read the stored tip state into memory. Called once on app start. */
export const loadFeatureTips = async (): Promise<void> => {
  const [storedEnabled, storedDismissed, storedLastShown] = await Promise.all([
    SecureStore.getItemAsync(ENABLED_STORAGE_KEY).catch(() => null),
    SecureStore.getItemAsync(DISMISSED_STORAGE_KEY).catch(() => null),
    SecureStore.getItemAsync(LAST_SHOWN_STORAGE_KEY).catch(() => null),
  ]);
  update({
    // Anything other than an explicit opt-out means tips are on.
    enabled: storedEnabled !== 'false',
    dismissedForever: parseDismissed(storedDismissed),
    lastShownAt: parseLastShownAt(storedLastShown),
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
    activeTipId: state.activeTipId === id ? null : state.activeTipId,
  });
  persistDismissed(dismissedForever);
};

/**
 * Closing the dialog when there is nothing left for it to remind the user
 * about (e.g. the notification-permission tip, closed while permission is
 * already granted): just hides it, leaving no reminder in the bell and not
 * adding to the "hidden tips" count in Settings — there is nothing to undo.
 */
export const closeTip = (id: FeatureTipId): void => {
  update({
    forcedTipId: state.forcedTipId === id ? null : state.forcedTipId,
    activeTipId: state.activeTipId === id ? null : state.activeTipId,
  });
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
    activeTipId: state.activeTipId === id ? null : state.activeTipId,
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
  trackTipShown(id);
};

/**
 * A cinema preset was just saved (from the tip itself or anywhere else, e.g.
 * the cinema filter's own "save preset" flow): the user has now found the
 * feature on their own, so the tip retires for good, even if every preset is
 * later deleted.
 */
export const retireCinemaPresetTip = (): void => {
  if (state.dismissedForever.has('cinema-presets')) return;
  dismissTipForever('cinema-presets');
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
 * The one chance per session to surface a tip. Call this once eligibility data
 * has actually loaded (not just once eligibility is *true*) and a short delay
 * has passed, so a tip never flashes up mid-load or the instant the app opens.
 *
 * Candidates should be passed most-useful-first (priority order); the first
 * one that is eligible, not permanently dismissed, not snoozed this session,
 * and off cooldown is the only one considered. Even then, it only actually
 * shows `TIP_SHOW_CHANCE` of the time — most opens show nothing at all.
 *
 * Safe to call more than once (e.g. on every render): a no-op once the
 * session's roll has already happened.
 */
export const rollForFeatureTip = (candidates: readonly FeatureTipCandidate[]): void => {
  if (state.rollDone || !state.isLoaded) return;
  if (!state.enabled) {
    update({ rollDone: true });
    return;
  }

  const winner = candidates.find(
    (candidate) =>
      candidate.isEligible &&
      !state.dismissedForever.has(candidate.id) &&
      !state.hiddenThisSession.has(candidate.id) &&
      !isInCooldown(candidate.id)
  );

  if (winner && Math.random() < TIP_SHOW_CHANCE) {
    const lastShownAt = { ...state.lastShownAt, [winner.id]: Date.now() };
    update({ rollDone: true, activeTipId: winner.id, lastShownAt });
    persistLastShownAt(lastShownAt);
    trackTipShown(winner.id);
    return;
  }
  update({ rollDone: true });
};

/**
 * Which tip, if any, should be on screen right now. Reflects the dev override,
 * a notification-centre reopen, or whichever tip (if any) won this session's
 * one roll via `rollForFeatureTip`.
 */
export const useFirstVisibleTip = (): FeatureTipId | null => {
  const { enabled, hiddenThisSession, forcedTipId, activeTipId, isLoaded } =
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
  if (activeTipId && !hiddenThisSession.has(activeTipId)) return activeTipId;
  return null;
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
