/**
 * Renders at most one feature tip. Candidates are listed in priority order —
 * verify email, notifications, cinemas, friends, Letterboxd, filter presets,
 * watchlist digest — and `rollForFeatureTip` applies eligibility, dismissal,
 * per-tip cooldowns and a random chance, so the user is never handed a stack of
 * nags and does not see a tip on every single app open. The exception is
 * "verify email", which is unfinished business rather than a suggestion and
 * does appear on every open until it is done.
 *
 * The roll happens once per session, a short delay after all the eligibility
 * data has actually loaded (not just once eligibility looks true), so nothing
 * flashes up mid-load or the instant the app opens.
 *
 * To add a tip: give it an id in `utils/feature-tips`, compute its eligibility
 * here as a top-level hook call (never inside a loop — rules of hooks), add it
 * to the candidate list in priority order, and render its component below.
 */
import { useEffect, useState } from "react";
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
import FilterPresetTip from "@/components/tips/FilterPresetTip";
import LetterboxdUsernameTip from "@/components/tips/LetterboxdUsernameTip";
import NotificationPermissionTip from "@/components/tips/NotificationPermissionTip";
import VerifyEmailTip from "@/components/tips/VerifyEmailTip";
import WatchlistDigestTip from "@/components/tips/WatchlistDigestTip";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useSystemNotificationPermission,
  wantsPushNotifications,
} from "@/hooks/useNotificationPreferences";
import { rollForFeatureTip, useFirstVisibleTip } from "@/utils/feature-tips";
import { useIsIntroOwed } from "@/utils/intro";

/** Give the app a moment to settle before nagging, even once data is ready. */
const TIP_ROLL_DELAY_MS = 1500;

export default function FeatureTipsHost() {
  const { user } = useAuth();
  // The host lives inside a tab screen that stays mounted when the user leaves
  // it, and the tip is a blocking dialog, so it must not outlive the screen.
  const isFocused = useIsFocused();
  // A first-time user is being walked through these very features right now; a
  // tip on top of the intro would be nagging about something in progress.
  // Deliberately "owed" rather than "active": that also covers the gap before
  // the walkthrough has started, and the filters highlight it ends on, neither
  // of which is a moment to put a dialog over.
  const isIntroOwed = useIsIntroOwed();
  const { status: permissionStatus, isGranted: isPermissionGranted } =
    useSystemNotificationPermission();
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
  // Only nag about the system block when the user actually asked for a push.
  // Someone who turned every notification off, or routed them all to email,
  // made that choice deliberately and does not need permission at all.
  const isBlockedFromNotifications =
    permissionStatus !== null && !isPermissionGranted && wantsPushNotifications(user);
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
    permissionStatus !== null;

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

  useEffect(() => {
    if (!readyToRoll) return;
    rollForFeatureTip([
      // Priority order, most-broken first:
      //  0. verify email — not a suggestion but unfinished business, and the
      //     only candidate exempt from the chance, the cooldown and the
      //     Settings switch (see ALWAYS_SHOW_TIP_IDS). Whenever it is eligible
      //     it wins, so nothing below it is reached until the address is
      //     confirmed.
      //  1. notifications — the only tip about something already failing: the
      //     user asked for pushes and the system is silently dropping them.
      //     Rarely eligible, so it costs the others almost nothing.
      //  2. cinemas — an unfiltered feed makes every screen noisier, and it is
      //     one tap to fix. Normally handled by the intro, so this is the user
      //     who skipped that page.
      //  3. friends — the social half of the app, but it needs other people to
      //     accept before it pays off.
      //  4. Letterboxd, 5. filter presets — real conveniences, no urgency;
      //     both also carry the longer cooldown.
      //  6. watchlist digest — last on purpose: a niche convenience, behind a
      //     backend switch, with the longest cooldown and lowest chance of the
      //     lot. It should feel like something you stumble on, not a pitch.
      { id: "verify-email", isEligible: needsEmailVerification },
      { id: "notification-permission", isEligible: isBlockedFromNotifications },
      { id: "cinema-presets", isEligible: shouldSuggestCinemaPreset },
      { id: "add-friends", isEligible: shouldSuggestAddFriends },
      { id: "letterboxd-username", isEligible: !hasLetterboxdUsername },
      { id: "filter-presets", isEligible: shouldSuggestFilterPreset },
      { id: "watchlist-digest", isEligible: shouldSuggestWatchlistDigest },
    ]);
  }, [
    readyToRoll,
    needsEmailVerification,
    shouldSuggestCinemaPreset,
    shouldSuggestAddFriends,
    isBlockedFromNotifications,
    hasLetterboxdUsername,
    shouldSuggestFilterPreset,
    shouldSuggestWatchlistDigest,
  ]);

  const visibleTipId = useFirstVisibleTip();

  if (!isFocused || isIntroOwed) return null;
  if (visibleTipId === "verify-email") return <VerifyEmailTip />;
  if (visibleTipId === "cinema-presets") return <CinemaPresetTip />;
  if (visibleTipId === "add-friends") return <AddFriendsTip />;
  if (visibleTipId === "notification-permission") return <NotificationPermissionTip />;
  if (visibleTipId === "letterboxd-username") return <LetterboxdUsernameTip />;
  if (visibleTipId === "filter-presets") return <FilterPresetTip />;
  if (visibleTipId === "watchlist-digest") return <WatchlistDigestTip />;
  return null;
}
