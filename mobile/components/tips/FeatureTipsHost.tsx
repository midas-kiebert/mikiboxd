/**
 * Renders at most one feature tip. Candidates are listed in priority order —
 * verify email; the two "you missed something" notification tips (an invite,
 * a sold-out screening); cinemas, friends, Letterboxd,
 * Letterboxd avatar, filter presets, watchlist digest, interest reminders and
 * the Cineville pass — and `rollForFeatureTip` applies eligibility, dismissal,
 * per-tip cooldowns and a random chance, so the user is never handed a stack of
 * nags and does not see a tip on every single app open. The exceptions are
 * "verify email", which is unfinished business rather than a suggestion and
 * does appear on every open until it is done, and the event tips, which are
 * rationed by the events themselves (see `EVENT_TIP_IDS`).
 *
 * The roll happens once per session, a short delay after all the eligibility
 * data has actually loaded (not just once eligibility looks true), so nothing
 * flashes up mid-load or the instant the app opens. Each later return to the
 * foreground gets one more chance, for the event tips only
 * (`rollForEventTip`), about whatever happened while the app was away.
 *
 * To add a tip: give it an id in `utils/feature-tips`, compute its eligibility
 * here as a top-level hook call (never inside a loop — rules of hooks), add it
 * to the candidate list in priority order, and render its component below.
 */
import { useEffect, useRef, useState } from "react";
import { useIsFocused } from "expo-router/react-navigation";
import { useQuery } from "@tanstack/react-query";
import useAuth from "shared/hooks/useAuth";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchFriends } from "shared/hooks/useFetchFriends";
import { useFetchSentRequests } from "shared/hooks/useFetchSentRequests";

import { findMyCinemasPreset, useCinemaPresets } from "@/components/filters/cinema-presets";
import {
  displayPresetsQueryKey,
  fetchDisplayPresets,
} from "@/components/filters/saved-presets";
import AddFriendsTip from "@/components/tips/AddFriendsTip";
import CinemaPresetTip from "@/components/tips/CinemaPresetTip";
import CinevillePassTip from "@/components/tips/CinevillePassTip";
import FilterPresetTip from "@/components/tips/FilterPresetTip";
import InterestRemindersTip from "@/components/tips/InterestRemindersTip";
import InviteTip from "@/components/tips/InviteTip";
import LetterboxdAvatarTip from "@/components/tips/LetterboxdAvatarTip";
import LetterboxdUsernameTip from "@/components/tips/LetterboxdUsernameTip";
import SoldOutTip from "@/components/tips/SoldOutTip";
import VerifyEmailTip from "@/components/tips/VerifyEmailTip";
import WatchlistDigestTip from "@/components/tips/WatchlistDigestTip";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  isNotificationDeliverable,
  useCanReceivePush,
} from "@/hooks/useNotificationPreferences";
import { useAwayEvents, useAwayEventsTracking } from "@/utils/away-events";
import { useCinevilleCardDigits } from "@/utils/cineville-card";
import {
  type FeatureTipCandidate,
  rollForEventTip,
  rollForFeatureTip,
  useFirstVisibleTip,
} from "@/utils/feature-tips";
import { useIsIntroOwed } from "@/utils/intro";

/** Give the app a moment to settle before nagging, even once data is ready. */
const TIP_ROLL_DELAY_MS = 1500;

export default function FeatureTipsHost() {
  const { user } = useAuth();
  // The host lives in the tabs layout, which stays mounted under any screen
  // pushed on top of it (a film page, say). The tip is a blocking dialog, so it
  // only shows while the tabs themselves are on screen — any tab.
  const isFocused = useIsFocused();
  // A first-time user is being walked through these very features right now; a
  // tip on top of the intro would be nagging about something in progress.
  // Deliberately "owed" rather than "active": that also covers the gap before
  // the walkthrough has started, and the filters highlight it ends on, neither
  // of which is a moment to put a dialog over.
  const isIntroOwed = useIsIntroOwed();
  const canPush = useCanReceivePush();
  useAwayEventsTracking(user ? String(user.id) : null);
  const { events: awayEvents, windowId } = useAwayEvents();
  const cinevilleDigits = useCinevilleCardDigits();
  const { data: cinemas } = useFetchCinemas();
  const { data: friends } = useFetchFriends({ enabled: Boolean(user) });
  const { data: sentRequests } = useFetchSentRequests({ enabled: Boolean(user) });
  const { data: cinemaPresets } = useCinemaPresets({ enabled: Boolean(user) });
  const { data: filterPresets } = useQuery({
    queryKey: displayPresetsQueryKey,
    queryFn: () => fetchDisplayPresets(),
    enabled: Boolean(user),
  });

  // Positive check, and from the loaded account only: an unconfirmed address is
  // something we know, never something we have not heard about yet.
  const currentUser = useCurrentUser();
  const needsEmailVerification = currentUser !== undefined && !currentUser.email_verified;
  // Decided entirely by the backend, so the digest can be advertised (or not)
  // without a client release: it already accounts for the server-side switch,
  // a confirmed address, and whether this account ever turned the digest on.
  const shouldSuggestWatchlistDigest = currentUser?.show_watchlist_digest_tip === true;

  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());
  // Only once a sync has actually read a picture: offering "use your picture"
  // with nothing to show would be a promise the app cannot keep yet. Switching
  // it on (here or in Settings) is what ends eligibility.
  const shouldSuggestLetterboxdAvatar =
    hasLetterboxdUsername &&
    Boolean(currentUser?.letterboxd_avatar_url) &&
    currentUser?.use_letterboxd_avatar === false;

  // The tip nudges the user to set their cinemas, so it asks whether that row
  // exists — not whether the list is empty. The list never is: the backend
  // always prepends a synthetic "All cinemas" entry, which made the old
  // `length === 0` test permanently false and the tip unreachable.
  // Once set, the user has found the feature; that stays true even if they
  // later clear everything, so this never re-checks after the first save (see
  // `retireCinemaPresetTip`, called on save).
  const shouldSuggestCinemaPreset =
    Boolean(cinemas?.length) &&
    cinemaPresets !== undefined &&
    findMyCinemasPreset(cinemaPresets) === null;
  const shouldSuggestAddFriends =
    friends !== undefined && sentRequests !== undefined &&
    friends.length === 0 && sentRequests.length === 0;
  // The event tips: something happened while the app was away that the user
  // was never told about, because that notification is off or cannot reach
  // this device. Each offers exactly that notification.
  const missesNotification = (
    key: Parameters<typeof isNotificationDeliverable>[1]
  ): boolean => !isNotificationDeliverable(currentUser, key, canPush === true);
  const soldOutScreening = awayEvents?.sold_out[0] ?? null;
  // A missed invite beats one that can still be answered: it is the proof
  // that notifications matter. Within each kind, the earliest screening (the
  // lists come back sorted by screening date).
  const missedInvite = awayEvents?.missed_invites[0] ?? null;
  const upcomingInvite = awayEvents?.upcoming_invites[0] ?? null;
  const tipInvite = missedInvite ?? upcomingInvite;
  const shouldSuggestInvites =
    tipInvite !== null && missesNotification("notify_on_showtime_ping");
  const shouldSuggestSeatAlerts =
    soldOutScreening !== null && missesNotification("notify_on_seat_alert");
  const shouldSuggestInterestReminders =
    currentUser !== undefined && !currentUser.notify_on_interest_reminder;
  // Null means the number is still being read from storage.
  const shouldSuggestCinevillePass = cinevilleDigits === null;
  const shouldSuggestFilterPreset = filterPresets !== undefined && filterPresets.length === 0;

  // Everything a candidate below reads must have actually resolved before the
  // one-shot roll happens, so eligibility reflects real data rather than a
  // momentary "still loading" false.
  const dataReady =
    Boolean(user) &&
    cinemas !== undefined &&
    friends !== undefined &&
    sentRequests !== undefined &&
    cinemaPresets !== undefined &&
    filterPresets !== undefined &&
    currentUser !== undefined &&
    canPush !== null &&
    cinevilleDigits !== undefined &&
    awayEvents !== null;

  const [readyToRoll, setReadyToRoll] = useState(false);
  useEffect(() => {
    if (isIntroOwed) return;
    // The verification nudge does not wait for the other tips' data. It is the
    // only candidate that can win while it is eligible, so there is nothing to
    // weigh it against — and holding it back would mean one slow or failed
    // query is enough for the whole session to pass without it.
    if (!dataReady && !needsEmailVerification) return;
    const timer = setTimeout(() => setReadyToRoll(true), TIP_ROLL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dataReady, needsEmailVerification, isIntroOwed]);

  // Priority order, most-broken first:
  //  0. verify email — not a suggestion but unfinished business, and exempt
  //     from the chance, the cooldown and the Settings switch (see
  //     ALWAYS_SHOW_TIP_IDS). Whenever it is eligible it wins, so nothing below
  //     it is reached until the address is confirmed.
  //  1-2. the event tips — an invite (still to answer, or missed) and a
  //     sold-out screening, each only for events since the app was last used.
  //     (No friend-request tip: that one is reasonable to have off.) Ahead of
  //     every suggestion because they come with proof of what the user is
  //     missing, and they are rare by construction.
  //  4. cinemas — an unfiltered feed makes every screen noisier, and it is
  //     one tap to fix. Normally handled by the intro, so this is the user
  //     who skipped that page.
  //  5. friends — the social half of the app, but it needs other people to
  //     accept before it pays off.
  //  6. Letterboxd, 7. filter presets — real conveniences, no urgency; both
  //     carry the longer cooldown.
  //  8. watchlist digest, 9. interest reminders, 10. the Cineville pass —
  //     niche conveniences with the longest cooldowns. They should feel like
  //     something you stumble on, not a pitch.
  //  11. the Letterboxd avatar — last of all: purely cosmetic, and
  //     the username tip already asks it the moment a username is saved. Never
  //     competes with the username tip: the picture needs a username first.
  const candidates: FeatureTipCandidate[] = [
    { id: "verify-email", isEligible: needsEmailVerification },
    { id: "invite", isEligible: shouldSuggestInvites },
    { id: "sold-out", isEligible: shouldSuggestSeatAlerts },
    { id: "cinema-presets", isEligible: shouldSuggestCinemaPreset },
    { id: "add-friends", isEligible: shouldSuggestAddFriends },
    { id: "letterboxd-username", isEligible: !hasLetterboxdUsername },
    { id: "filter-presets", isEligible: shouldSuggestFilterPreset },
    { id: "watchlist-digest", isEligible: shouldSuggestWatchlistDigest },
    { id: "interest-reminders", isEligible: shouldSuggestInterestReminders },
    { id: "cineville-pass", isEligible: shouldSuggestCinevillePass },
    { id: "letterboxd-avatar", isEligible: shouldSuggestLetterboxdAvatar },
  ];
  // The candidates change identity every render; the roll only needs to see
  // the latest list when it actually runs.
  const candidatesRef = useRef(candidates);
  useEffect(() => {
    candidatesRef.current = candidates;
  });

  useEffect(() => {
    if (!readyToRoll) return;
    rollForFeatureTip(candidatesRef.current);
  }, [readyToRoll]);

  // Every later return to the foreground: one more chance, for the events of
  // that absence. The first window is the launch itself, which the roll above
  // already covered.
  const rolledWindowIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!readyToRoll || awayEvents === null || isIntroOwed) return;
    const previous = rolledWindowIdRef.current;
    rolledWindowIdRef.current = windowId;
    if (previous === null || previous === windowId) return;
    rollForEventTip(candidatesRef.current);
  }, [awayEvents, isIntroOwed, readyToRoll, windowId]);

  const visibleTipId = useFirstVisibleTip();

  if (!isFocused || isIntroOwed) return null;
  if (visibleTipId === "verify-email") return <VerifyEmailTip />;
  if (visibleTipId === "cinema-presets") return <CinemaPresetTip />;
  if (visibleTipId === "add-friends") return <AddFriendsTip />;
  if (visibleTipId === "invite" && tipInvite) {
    return <InviteTip invite={tipInvite} isMissed={missedInvite !== null} />;
  }
  if (visibleTipId === "sold-out" && soldOutScreening) {
    return <SoldOutTip screening={soldOutScreening} />;
  }
  if (visibleTipId === "interest-reminders") return <InterestRemindersTip />;
  if (visibleTipId === "cineville-pass") return <CinevillePassTip />;
  if (visibleTipId === "letterboxd-username") return <LetterboxdUsernameTip />;
  if (visibleTipId === "letterboxd-avatar") return <LetterboxdAvatarTip />;
  if (visibleTipId === "filter-presets") return <FilterPresetTip />;
  if (visibleTipId === "watchlist-digest") return <WatchlistDigestTip />;
  return null;
}
