/**
 * Renders at most one feature tip. Candidates are listed most-useful-first and
 * `useFirstVisibleTip` applies the dismissal rules, so the user is never handed
 * a stack of nags.
 *
 * To add a tip: give it an id in `utils/feature-tips`, compute its eligibility
 * here as a top-level hook call (never inside a loop — rules of hooks), add it
 * to the candidate list, and render its component below.
 */
import { useIsFocused } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import useAuth from "shared/hooks/useAuth";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchFriends } from "shared/hooks/useFetchFriends";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import { useCinemaPresets } from "@/components/filters/cinema-presets";
import { hasAnyActiveFilter } from "@/components/filters/filter-preset-utils";
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
import { useCurrentFilterPresetState } from "@/hooks/useSharedTabFilters";
import { useFirstVisibleTip } from "@/utils/feature-tips";

export default function FeatureTipsHost() {
  const { user } = useAuth();
  // The host lives inside a tab screen that stays mounted when the user leaves
  // it, and the tip is a blocking dialog, so it must not outlive the screen.
  const isFocused = useIsFocused();
  const { status: permissionStatus, isGranted: isPermissionGranted } =
    useSystemNotificationPermission();
  const { data: cinemas } = useFetchCinemas();
  const { data: friends } = useFetchFriends({ enabled: Boolean(user) });
  const { data: favoriteCinemaIds } = useFetchSelectedCinemas();
  const { selections: sessionCinemaIds } = useSessionCinemaSelections();
  const { data: cinemaPresets } = useCinemaPresets({ enabled: Boolean(user) });
  const { data: filterPresets } = useQuery({
    queryKey: displayPresetsQueryKey,
    queryFn: () => fetchDisplayPresets(),
    enabled: Boolean(user),
  });
  const currentFilters = useCurrentFilterPresetState();

  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());

  // Someone actively filtering has a combination worth keeping; someone with a
  // clean slate has nothing to save yet and would only be nagged.
  const shouldSuggestFilterPreset =
    filterPresets !== undefined &&
    filterPresets.length === 0 &&
    hasAnyActiveFilter(currentFilters);

  // Someone who has narrowed their cinemas down already understands the filter;
  // the tip is for the user still browsing every cinema in the country, and
  // only while they have no preset to fall back on.
  const selectedCinemaCount = (sessionCinemaIds ?? favoriteCinemaIds ?? []).length;
  const hasNarrowedCinemas =
    selectedCinemaCount > 0 && selectedCinemaCount < (cinemas?.length ?? 0);
  const shouldSuggestCinemaPreset =
    Boolean(cinemas?.length) &&
    cinemaPresets !== undefined &&
    cinemaPresets.length === 0 &&
    !hasNarrowedCinemas;
  // Only nag about the system block when the user actually asked for a push.
  // Someone who turned every notification off, or routed them all to email,
  // made that choice deliberately and does not need permission at all.
  const isBlockedFromNotifications =
    permissionStatus !== null && !isPermissionGranted && wantsPushNotifications(user);

  const visibleTipId = useFirstVisibleTip([
    // Nothing to suggest until the user is actually loaded and logged in.
    { id: "letterboxd-username", isEligible: Boolean(user) && !hasLetterboxdUsername },
    { id: "add-friends", isEligible: Boolean(user) && friends !== undefined && friends.length === 0 },
    { id: "notification-permission", isEligible: Boolean(user) && isBlockedFromNotifications },
    { id: "cinema-presets", isEligible: Boolean(user) && shouldSuggestCinemaPreset },
    { id: "filter-presets", isEligible: Boolean(user) && shouldSuggestFilterPreset },
  ]);

  if (!isFocused) return null;
  if (visibleTipId === "letterboxd-username") return <LetterboxdUsernameTip />;
  if (visibleTipId === "add-friends") return <AddFriendsTip />;
  if (visibleTipId === "notification-permission") return <NotificationPermissionTip />;
  if (visibleTipId === "cinema-presets") return <CinemaPresetTip />;
  if (visibleTipId === "filter-presets") return <FilterPresetTip />;
  return null;
}
