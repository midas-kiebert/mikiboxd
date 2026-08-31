/**
 * Expo Router screen/module for (tabs) / activity. One feed, three slices of
 * who it's about:
 *
 *   All     — you and your friends, together (the original "you + friends"
 *             query the premade "Friends' showtimes" filter preset used to
 *             apply on the Showtimes tab).
 *   Friends — friends only, your own selections dropped. See `friendsOnly`
 *             in `_build_main_page_showtimes_query`
 *             (`backend/app/crud/showtime.py`).
 *   You     — your personal agenda: what you're going to or interested in,
 *             plus anything a friend has invited you to. This replaces the
 *             standalone Agenda tab; the invite always counts here now
 *             (the old "include invites" toggle is gone, since an invite is
 *             always relevant to you).
 *
 * All three ignore the viewer's cinema selection on purpose — see
 * `_skips_cinema_default` in `backend/app/services/viewer_context.py` for the
 * "All"/"Friends" side; "You" never had a cinema filter to begin with.
 */
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MeService } from "shared";
import { useFetchMainPageShowtimes } from "shared/hooks/useFetchMainPageShowtimes";
import { useFetchAgenda } from "shared/hooks/useFetchAgenda";
import { useFetchFriends } from "shared/hooks/useFetchFriends";

import TopSafeAreaView from "@/components/layout/TopSafeAreaView";
import TabScreenSkeleton from "@/components/layout/TabScreenSkeleton";
import { tabContentHoldMs } from "@/components/tab-bar";
import { useDeferredMount } from "@/utils/use-deferred-mount";
import TopBar from "@/components/layout/TopBar";
import { ThemedText } from "@/components/themed-text";
import SignedOutPanel from "@/components/auth/SignedOutPanel";
import { ShowtimesListContent } from "@/components/showtimes/ShowtimesScreen";
import SegmentedControl, { type SegmentedOption } from "@/components/ui/SegmentedControl";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useIsSignedIn } from "@/utils/auth-session";
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from "@/utils/reset-infinite-query";
import { triggerSelectionHaptic } from "@/utils/long-press";

/** What signing in would put on this tab, in the order it would appear. */
const ACTIVITY_HIGHLIGHTS = [
  "Every screening a friend is going to or interested in",
  "Your own agenda, invites included",
  "Across every cinema, no filters to set up",
] as const;

/** Both statuses: this feed is "who's doing something about this screening", not just "who's locked in". */
const ACTIVITY_STATUSES = ["GOING", "INTERESTED"] as const;

type ActivityMode = "all" | "friends" | "you";

const MODE_OPTIONS: readonly SegmentedOption<ActivityMode>[] = [
  { value: "all", label: "All", icon: "grid-view" },
  { value: "friends", label: "Friends", icon: "people" },
  { value: "you", label: "You", icon: "person" },
];

/** Which mode a `?mode=` deep link lands in (e.g. a showtime-invite push notification). */
const VALID_DEEP_LINK_MODES: readonly string[] = MODE_OPTIONS.map((option) => option.value);

type ThemeColors = typeof import("@/constants/theme").Colors.light;

function ActivityScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  // A feed of who's doing what is a feed about accounts, so there is nothing
  // here for a guest — same shape as Friends, which stays in the bar and
  // explains itself instead of disappearing.
  const isSignedIn = useIsSignedIn();
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());

  const { mode: deepLinkMode } = useLocalSearchParams<{ mode?: string | string[] }>();
  const requestedMode = useMemo((): ActivityMode | null => {
    const normalized = Array.isArray(deepLinkMode) ? deepLinkMode[0] : deepLinkMode;
    return normalized && VALID_DEEP_LINK_MODES.includes(normalized)
      ? (normalized as ActivityMode)
      : null;
  }, [deepLinkMode]);
  const [mode, setMode] = useState<ActivityMode>(requestedMode ?? "all");

  useEffect(() => {
    if (requestedMode === null) return;
    setMode(requestedMode);
  }, [requestedMode]);

  const isYou = mode === "you";
  const isFriendsOnly = mode === "friends";

  const filters = useMemo(
    () => ({ selectedStatuses: [...ACTIVITY_STATUSES], friendsOnly: isFriendsOnly }),
    [isFriendsOnly]
  );

  const mainQuery = useFetchMainPageShowtimes({
    limit: 20,
    snapshotTime,
    filters,
    enabled: isFocused && isSignedIn && !isYou,
  });

  // "You" is your personal agenda rather than the friends-oriented main-page
  // query — it already knows how to fold invites in (`includeInvited`), which
  // is always on here: an invite is relevant to you by definition, so there is
  // no toggle for it any more.
  const agendaQuery = useFetchAgenda({
    limit: 20,
    snapshotTime,
    includeInterested: true,
    includeInvited: true,
    enabled: isFocused && isSignedIn && isYou,
  });

  const showtimes = useMemo(
    () => (isYou ? agendaQuery.data : mainQuery.data)?.pages.flat() ?? [],
    [isYou, agendaQuery.data, mainQuery.data]
  );
  const isLoading = isYou ? agendaQuery.isLoading : mainQuery.isLoading;
  const isFetching = isYou ? agendaQuery.isFetching : mainQuery.isFetching;
  const isFetchingNextPage = isYou ? agendaQuery.isFetchingNextPage : mainQuery.isFetchingNextPage;
  const hasNextPage = isYou ? agendaQuery.hasNextPage : mainQuery.hasNextPage;
  const fetchNextPage = isYou ? agendaQuery.fetchNextPage : mainQuery.fetchNextPage;

  // Distinguishes "you have no friends yet" from "your friends have nothing
  // on right now" — the empty state and its CTA differ between the two. Not
  // needed for "You", which has its own, friend-independent empty state.
  const { data: friends, isFetching: isFetchingFriends } = useFetchFriends({
    enabled: isSignedIn && !isYou,
  });
  const hasFriends = (friends?.length ?? 0) > 0;
  const isLoadingFriends = isFetchingFriends && friends === undefined;

  // Mark received invites as seen as soon as "You" is viewed, clearing the badge.
  const markSeenMutation = useMutation({
    mutationFn: () => MeService.markMyShowtimePingsSeen(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings", "unseenCount"] });
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] });
      // The bell badge counts unseen invites too, so refresh it to stay linked.
      queryClient.invalidateQueries({ queryKey: ["me", "notifications", "unseenCount"] });
    },
    onError: (error) => {
      console.error("Error marking showtime invites as seen:", error);
    },
  });

  useEffect(() => {
    if (!isFocused || !isSignedIn || !isYou) return;
    markSeenMutation.mutate();
    // Trigger once whenever "You" gains focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, isSignedIn, isYou]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshInfiniteQueryWithFreshSnapshot({ setSnapshotTime });
    } finally {
      setRefreshing(false);
    }
  };

  const goToAddFriends = () => {
    triggerSelectionHaptic();
    router.push({ pathname: "/(tabs)/friends", params: { tab: "users" } });
  };

  const goToShowtimes = () => {
    triggerSelectionHaptic();
    router.push("/(tabs)");
  };

  const handleChangeMode = (next: ActivityMode) => {
    triggerSelectionHaptic();
    setMode(next);
  };

  const emptyText = isYou
    ? "Nothing in your agenda yet"
    : hasFriends
      ? "Nothing lined up right now"
      : "No friends yet";
  const emptyExtra = isYou || isLoadingFriends ? null : hasFriends ? (
    <View style={styles.emptyActionRow}>
      <ThemedText style={styles.emptyExtraText}>
        Nobody's marked a screening going or interested yet.
      </ThemedText>
      <TouchableOpacity
        style={styles.emptyAction}
        onPress={goToShowtimes}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Browse all showtimes"
      >
        <MaterialIcons name="list" size={17} color={colors.pillActiveText} />
        <ThemedText style={styles.emptyActionText}>Browse showtimes</ThemedText>
      </TouchableOpacity>
    </View>
  ) : (
    <View style={styles.emptyActionRow}>
      <ThemedText style={styles.emptyExtraText}>
        Add friends to see what they're going to.
      </ThemedText>
      <TouchableOpacity
        style={styles.emptyAction}
        onPress={goToAddFriends}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Add friends"
      >
        <MaterialIcons name="person-add" size={17} color={colors.pillActiveText} />
        <ThemedText style={styles.emptyActionText}>Add friends</ThemedText>
      </TouchableOpacity>
    </View>
  );

  // Render/output using the state and derived values prepared above.
  if (!isSignedIn) {
    return (
      <TopSafeAreaView style={styles.container}>
        <TopBar title="Activity" icon="bolt.fill" />
        <SignedOutPanel feature="activity" bullets={ACTIVITY_HIGHLIGHTS} />
      </TopSafeAreaView>
    );
  }

  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar title="Activity" icon="bolt.fill" />
      <View style={styles.modeRow}>
        <SegmentedControl
          options={MODE_OPTIONS}
          value={mode}
          onChange={handleChangeMode}
          accessibilityLabelPrefix="Show"
          stretch
          size="large"
        />
      </View>
      <ShowtimesListContent
        showtimes={showtimes}
        isLoading={isLoading}
        isFetching={isFetching}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
        onLoadMore={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        emptyText={emptyText}
        emptyExtra={emptyExtra}
      />
    </TopSafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    modeRow: {
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    emptyActionRow: { alignItems: "center", gap: 4 },
    emptyExtraText: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: "center",
    },
    emptyAction: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginTop: 10,
      borderRadius: 14,
      backgroundColor: colors.tint,
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    emptyActionText: {
      color: colors.pillActiveText,
      fontSize: 14,
      fontWeight: "700",
      letterSpacing: 0.2,
    },
  });

/**
 * The shell in front of the screen above.
 *
 * A tab is built the first time it is opened, and until it is, the tab you
 * pressed away from stays on screen — which reads as the press being ignored.
 * The gate is a component of its own so that every hook the screen owns lives
 * *behind* it: an early return inside one component would only defer the
 * render, not the queries and subscriptions that set it up.
 *
 * The wait is whatever {@link tabContentHoldMs} still owes the tab bar's press
 * flash, so the mount takes the UI thread only once that movement is over
 * rather than stalling it half-way. Once a tab has been built it is never
 * gated again.
 */
export default function ActivityScreenTab() {
  const ready = useDeferredMount("tab:activity", tabContentHoldMs);
  if (!ready) {
    return <TabScreenSkeleton title="Activity" icon="bolt.fill" rowHeight={112} />;
  }
  return <ActivityScreen />;
}
