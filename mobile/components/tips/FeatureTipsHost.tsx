/**
 * Renders at most one feature tip. Candidates are listed in priority order —
 * notifications, cinemas, friends, Letterboxd, filter presets — and
 * `rollForFeatureTip` applies eligibility, dismissal, per-tip cooldowns and a
 * random chance, so the user is never handed a stack of nags and does not see
 * a tip on every single app open.
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
import { useIsFocused } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import useAuth from "shared/hooks/useAuth";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchFriends } from "shared/hooks/useFetchFriends";
import { useFetchSentRequests } from "shared/hooks/useFetchSentRequests";

import { useCinemaPresets } from "@/components/filters/cinema-presets";
import {
  displayPresetsQueryKey,
  fetchDisplayPresets,
} from "@/components/filters/saved-presets";
import AddFriendsTip from "@/components/tips/AddFriendsTip";
import CinemaPresetTip from "@/components/tips/CinemaPresetTip";
import FilterPresetTip from "@/components/tips/FilterPresetTip";
import LetterboxdUsernameTip from "@/components/tips/LetterboxdUsernameTip";
import NotificationPermissionTip from "@/components/tips/NotificationPermissionTip";
import {
  useSystemNotificationPermission,
  wantsPushNotifications,
} from "@/hooks/useNotificationPreferences";
import { rollForFeatureTip, useFirstVisibleTip } from "@/utils/feature-tips";
import { useIsIntroActive } from "@/utils/intro";

/** Give the app a moment to settle before nagging, even once data is ready. */
const TIP_ROLL_DELAY_MS = 1500;

export default function FeatureTipsHost() {
  const { user } = useAuth();
  // The host lives inside a tab screen that stays mounted when the user leaves
  // it, and the tip is a blocking dialog, so it must not outlive the screen.
  const isFocused = useIsFocused();
  // A first-time user is being walked through these very features right now;
  // a tip on top of the intro would be nagging about something in progress.
  const isIntroActive = useIsIntroActive();
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

  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());

  // Once a preset exists the user has found the feature; that stays true even
  // if every preset is later deleted, so this never re-checks preset count
  // after the first save (see `retireCinemaPresetTip`, called on save).
  const shouldSuggestCinemaPreset =
    Boolean(cinemas?.length) && cinemaPresets !== undefined && cinemaPresets.length === 0;
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
    if (!dataReady || isIntroActive) return;
    const timer = setTimeout(() => setReadyToRoll(true), TIP_ROLL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dataReady, isIntroActive]);

  useEffect(() => {
    if (!readyToRoll) return;
    rollForFeatureTip([
      // Priority order, most-broken first:
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
      { id: "notification-permission", isEligible: isBlockedFromNotifications },
      { id: "cinema-presets", isEligible: shouldSuggestCinemaPreset },
      { id: "add-friends", isEligible: shouldSuggestAddFriends },
      { id: "letterboxd-username", isEligible: !hasLetterboxdUsername },
      { id: "filter-presets", isEligible: shouldSuggestFilterPreset },
    ]);
  }, [
    readyToRoll,
    shouldSuggestCinemaPreset,
    shouldSuggestAddFriends,
    isBlockedFromNotifications,
    hasLetterboxdUsername,
    shouldSuggestFilterPreset,
  ]);

  const visibleTipId = useFirstVisibleTip();

  if (!isFocused || isIntroActive) return null;
  if (visibleTipId === "cinema-presets") return <CinemaPresetTip />;
  if (visibleTipId === "add-friends") return <AddFriendsTip />;
  if (visibleTipId === "notification-permission") return <NotificationPermissionTip />;
  if (visibleTipId === "letterboxd-username") return <LetterboxdUsernameTip />;
  if (visibleTipId === "filter-presets") return <FilterPresetTip />;
  return null;
}
