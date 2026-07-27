/**
 * Layout-level provider that keeps one NotificationCenterSheet mounted and lets
 * the TopBar bell open it via the useNotificationCenter() hook.
 *
 * It owns the open state, the merged feed query, mark-seen-on-open (which clears
 * the bell badge), and the dismiss / accept / decline mutations — mirroring the
 * pattern in ShowtimeModalProvider. Showtime-related items open the showtime
 * modal in place; friend-request-accepted opens the Friends tab.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FriendsService, MeService, type NotificationFeedItem } from "shared";
import { useFetchNotifications } from "shared/hooks/useFetchNotifications";
import { usePrefetchShowtimeVisibility } from "shared/hooks/useShowtimeVisibility";

import NotificationCenterSheet from "@/components/notifications/NotificationCenterSheet";
import { useShowtimeModal } from "@/components/showtimes/ShowtimeModalProvider";
import { useRegisterBlockingOverlay } from "@/utils/blocking-overlays";
import {
  dismissSnoozedTip,
  type FeatureTipId,
  markSnoozedTipsSeen,
  reopenTip,
  useSnoozedTips,
} from "@/utils/feature-tips";
import { useIsIntroActive } from "@/utils/intro";

type NotificationCenterContextValue = {
  openNotificationCenter: () => void;
  closeNotificationCenter: () => void;
};

const NotificationCenterContext = createContext<NotificationCenterContextValue>({
  openNotificationCenter: () => {},
  closeNotificationCenter: () => {},
});

export function useNotificationCenter() {
  return useContext(NotificationCenterContext);
}

export function NotificationCenterProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { openShowtimeModalById } = useShowtimeModal();
  const [visible, setVisible] = useState(false);
  const [pendingAcceptId, setPendingAcceptId] = useState<string | null>(null);
  const [pendingDeclineId, setPendingDeclineId] = useState<string | null>(null);

  // Lets anything that must be the only thing on screen hold off while the
  // centre is open (currently the intro's filters highlight).
  useRegisterBlockingOverlay(visible);

  // The intro is its own blocking walkthrough; opened underneath it (e.g. a
  // bell tap right as the intro takes over), it would otherwise just be
  // sitting there, revealed once the intro ends instead of closed like it was.
  const isIntroActive = useIsIntroActive();
  useEffect(() => {
    if (isIntroActive) setVisible(false);
  }, [isIntroActive]);

  const { data: notifications, isLoading } = useFetchNotifications({ enabled: visible });
  const items = useMemo(() => notifications ?? [], [notifications]);
  const snoozedTips = useSnoozedTips();
  // Showtime notifications open the sheet, which needs the visibility mode.
  usePrefetchShowtimeVisibility(
    items.flatMap((item) => (item.showtime ? [item.showtime.id] : []))
  );

  const invalidateFeed = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["me", "notifications"] });
  }, [queryClient]);

  const { mutate: markSeen } = useMutation({
    mutationFn: () => MeService.markMyNotificationsSeen(),
    onSuccess: () => {
      // The backend marks notifications AND showtime invites seen, so refresh
      // every badge source — bell, agenda invite badge — to keep them linked.
      queryClient.invalidateQueries({ queryKey: ["me", "notifications", "unseenCount"] });
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings", "unseenCount"] });
      invalidateFeed();
    },
    onError: (error) => {
      console.error("Error marking notifications as seen:", error);
    },
  });

  // Clear the bell badge as soon as the centre is opened. The badge counts both
  // backend notifications and local tip reminders, so both are marked.
  useEffect(() => {
    if (!visible) return;
    markSeen();
    markSnoozedTipsSeen();
    // Fire once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const openNotificationCenter = useCallback(() => setVisible(true), []);
  const closeNotificationCenter = useCallback(() => setVisible(false), []);

  const { mutate: dismissNotification } = useMutation({
    mutationFn: (item: NotificationFeedItem) => {
      if (item.source === "notification") {
        return MeService.dismissMyNotification({ notificationId: Number(item.id) });
      }
      // Received invites are dismissed through the existing ping endpoint.
      return MeService.dismissMyShowtimePing({ pingId: Number(item.id) });
    },
    onError: (error) => {
      console.error("Error dismissing notification:", error);
    },
    onSettled: () => {
      invalidateFeed();
      queryClient.invalidateQueries({ queryKey: ["me", "notifications", "unseenCount"] });
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] });
    },
  });

  const { mutate: acceptRequest } = useMutation({
    mutationFn: (item: NotificationFeedItem) =>
      FriendsService.acceptFriendRequest({ senderId: item.id }),
    onMutate: (item) => setPendingAcceptId(item.id),
    onError: (error) => {
      console.error("Error accepting friend request:", error);
    },
    onSettled: () => {
      setPendingAcceptId(null);
      invalidateFeed();
      queryClient.invalidateQueries({ queryKey: ["me", "notifications", "unseenCount"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const { mutate: declineRequest } = useMutation({
    mutationFn: (item: NotificationFeedItem) =>
      FriendsService.declineFriendRequest({ senderId: item.id }),
    onMutate: (item) => setPendingDeclineId(item.id),
    onError: (error) => {
      console.error("Error declining friend request:", error);
    },
    onSettled: () => {
      setPendingDeclineId(null);
      invalidateFeed();
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const handleItemPress = useCallback(
    (item: NotificationFeedItem) => {
      if (item.showtime) {
        setVisible(false);
        openShowtimeModalById(item.showtime.id);
        return;
      }
      if (item.type === "friend_request_accepted") {
        setVisible(false);
        router.push({ pathname: "/(tabs)/friends", params: { tab: "friends" } });
      }
    },
    [openShowtimeModalById, router]
  );

  // Reopening puts the tip dialog back on screen. Its host lives on the main
  // showtimes tab, so get the user there first: the bell is on every screen.
  const handleTipPress = useCallback(
    (id: FeatureTipId) => {
      setVisible(false);
      reopenTip(id);
      router.replace("/(tabs)");
    },
    [router]
  );

  const value = useMemo<NotificationCenterContextValue>(
    () => ({ openNotificationCenter, closeNotificationCenter }),
    [openNotificationCenter, closeNotificationCenter]
  );

  return (
    <NotificationCenterContext.Provider value={value}>
      {children}
      <NotificationCenterSheet
        visible={visible}
        items={items}
        tips={snoozedTips}
        isLoading={isLoading}
        pendingAcceptId={pendingAcceptId}
        pendingDeclineId={pendingDeclineId}
        onClose={closeNotificationCenter}
        onItemPress={handleItemPress}
        onDismiss={dismissNotification}
        onAccept={acceptRequest}
        onDecline={declineRequest}
        onTipPress={handleTipPress}
        onTipDismiss={dismissSnoozedTip}
      />
    </NotificationCenterContext.Provider>
  );
}
