/**
 * Keeps the number on the app icon in sync with what is waiting for the user.
 *
 * Why this exists: on iOS a notification is easy to miss. The banner is brief,
 * Notification Center is a deliberate swipe away, and nothing on the home
 * screen says anything happened. Users told us they were missing things, and
 * the icon badge is the one signal that survives a missed banner.
 *
 * **The badge is not the bell's number.** The bell counts unseen *events* and
 * zeroes the moment the centre is opened; pending friend requests are badged
 * separately on the Friends tab, because a request stays outstanding until it
 * is accepted or declined. From the home screen there is only one number, so
 * it carries both — a friend request that badged nothing until you happened to
 * open the app was exactly the case people were missing. The consequence is
 * that opening the app clears the event half and leaves the friend-request
 * half lit, which is the truth of it.
 *
 * Local feature tips are deliberately left out even though they count towards
 * the bell: they are nudges the app invented, not something that happened to
 * the user, and badging the home screen for one is noise.
 *
 * The backend computes the same sum in `push_notifications.badge_count` and
 * sends it on every push, so the number is already right when the app is
 * opened from a notification. This hook is what keeps it right afterwards.
 */
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { useQueryClient } from "@tanstack/react-query";
import { useFetchNotificationUnseenCount } from "shared/hooks/useFetchNotificationUnseenCount";
import { useFetchReceivedRequests } from "shared/hooks/useFetchReceivedRequests";

import { Notifications } from "@/utils/notifications-module";

/** Matches the other account badges polled from the tab layout. */
const BADGE_POLL_INTERVAL_MS = 15000;

/**
 * @param enabled False for a guest or a signed-out device — the badge is then
 *   driven to zero rather than left on whatever the last session put there.
 */
export function useAppIconBadge(enabled: boolean): void {
  const queryClient = useQueryClient();

  // Both queries are already mounted elsewhere under these exact keys (the bell
  // in TopBar, the Friends tab badge), so React Query dedupes them and this
  // hook costs no extra requests. The interval is stated rather than left to
  // the default so both observers on a key ask for the same one.
  const { data: unseenCount } = useFetchNotificationUnseenCount({
    enabled,
    refetchIntervalMs: BADGE_POLL_INTERVAL_MS,
  });
  const { data: receivedRequests } = useFetchReceivedRequests({
    enabled,
    refetchIntervalMs: BADGE_POLL_INTERVAL_MS,
  });

  // Signing out is known immediately; a count is not known until it arrives.
  // The difference matters on a cold start: the push that was just tapped has
  // already put the right number on the icon, and treating "not fetched yet" as
  // zero would wipe it — permanently, for a launch that never gets a reply.
  const isKnown = !enabled || (unseenCount !== undefined && receivedRequests !== undefined);
  const badgeCount = enabled ? (unseenCount ?? 0) + (receivedRequests?.length ?? 0) : 0;

  // The OS call is cheap but not free, and both queries poll on a fifteen-second
  // loop; without this every tick would write the same number back.
  const lastAppliedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isKnown) return;
    if (lastAppliedRef.current === badgeCount) return;
    lastAppliedRef.current = badgeCount;
    // Failures here are not worth surfacing: the badge permission can be off,
    // and on Android it depends on the launcher supporting counts at all.
    void Notifications.setBadgeCountAsync(badgeCount).catch(() => {});
  }, [badgeCount, isKnown]);

  // Foregrounding is the moment the number has to be right — it is what the
  // user just acted on. React Query's `refetchOnWindowFocus` never fires in
  // React Native (nothing wires its focus manager to AppState), so the polling
  // interval alone would leave the badge up to fifteen seconds stale right when
  // it is being looked at.
  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void queryClient.invalidateQueries({ queryKey: ["me", "notifications", "unseenCount"] });
      void queryClient.invalidateQueries({ queryKey: ["users", "receivedRequests"] });
    });
    return () => subscription.remove();
  }, [enabled, queryClient]);
}
