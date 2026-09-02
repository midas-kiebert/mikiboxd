/**
 * Expo Router screen/module for (tabs) / activity. One feed, three slices of
 * who it's about:
 *
 *   All     — you and your friends, together (the original "you + friends"
 *             query the premade "Friends' showtimes" filter preset used to
 *             apply on the Showtimes tab).
 *   You     — your personal agenda: what you're going to or interested in,
 *             plus anything a friend has invited you to. This replaces the
 *             standalone Agenda tab; the invite always counts here now
 *             (the old "include invites" toggle is gone, since an invite is
 *             always relevant to you).
 *   Friends — friends only, your own selections dropped. See `friendsOnly`
 *             in `_build_main_page_showtimes_query`
 *             (`backend/app/crud/showtime.py`).
 *
 * "You" sits in the middle because it is the one slice reachable from either
 * side in a single swipe: the three are a pager as well as a control, and the
 * middle page is the one that is never two pages away.
 *
 * All three ignore the viewer's cinema selection on purpose — "All"/"Friends"
 * send `allCinemas`/`friendsOnly` so `_skips_cinema_default` in
 * `backend/app/services/viewer_context.py` leaves them unrestricted; "You"
 * never had a cinema filter to begin with.
 *
 * All three are also *mounted* at once, not just the selected one. A page has to
 * be there, with its data, before the finger reaches it — a page built on
 * release arrives after the swipe that asked for it, which is exactly what the
 * swipe was meant to avoid.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, TouchableOpacity, View, useWindowDimensions } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { GestureDetector } from "react-native-gesture-handler";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MeService } from "shared";
import { useFetchMainPageShowtimes } from "shared/hooks/useFetchMainPageShowtimes";
import { useFetchAgenda } from "shared/hooks/useFetchAgenda";
import { useFetchFriends } from "shared/hooks/useFetchFriends";

import CinevilleCardButton from "@/components/cineville/CinevilleCardButton";
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
import { useSwipePager } from "@/hooks/useSwipePager";
import { useIsSignedIn } from "@/utils/auth-session";
import { buildSnapshotTime, useSnapshotRefresh } from "@/utils/reset-infinite-query";
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

/** Left to right: the order of the segments *and* of the pages behind them. */
const MODE_OPTIONS: readonly SegmentedOption<ActivityMode>[] = [
  { value: "all", label: "All", icon: "grid-view" },
  { value: "you", label: "You", icon: "person" },
  { value: "friends", label: "Friends", icon: "people" },
];

/** Which mode a `?mode=` deep link lands in (e.g. a showtime-invite push notification). */
const VALID_DEEP_LINK_MODES: readonly string[] = MODE_OPTIONS.map((option) => option.value);

type ThemeColors = typeof import("@/constants/theme").Colors.light;

function ActivityScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const { width: pageWidth } = useWindowDimensions();
  // A feed of who's doing what is a feed about accounts, so there is nothing
  // here for a guest — same shape as Friends, which stays in the bar and
  // explains itself instead of disappearing.
  const isSignedIn = useIsSignedIn();
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

  const modeIndex = Math.max(
    0,
    MODE_OPTIONS.findIndex((option) => option.value === mode)
  );
  const isYou = mode === "you";

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

  // `useRef` rather than a value: `handleChangeMode` is handed to the pager as
  // `onIndexChange`, so it cannot close over the pager it is being built with.
  const goToPageRef = useRef<((index: number) => void) | null>(null);

  const handleChangeMode = useCallback((next: ActivityMode) => {
    // Start the pages moving here, not from the render this is about to cause:
    // that commit rebuilds three feeds, and until it lands nothing driven by
    // React state has moved. A swipe arrives with the movement already under
    // way, and this is how a tap does the same.
    goToPageRef.current?.(MODE_OPTIONS.findIndex((option) => option.value === next));
    setMode(next);
  }, []);

  const handleChangeIndex = useCallback(
    // No haptic: a swipe is a continuous gesture the user is already watching
    // answer them, unlike a tap, where the segment fires one of its own.
    (index: number) => handleChangeMode(MODE_OPTIONS[index].value),
    [handleChangeMode]
  );

  const { progress, panGesture, goTo } = useSwipePager({
    pageCount: MODE_OPTIONS.length,
    index: modeIndex,
    onIndexChange: handleChangeIndex,
    pageWidth,
  });
  goToPageRef.current = goTo;

  const pagerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -progress.value * pageWidth }],
  }));

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
          progress={progress}
        />
      </View>
      <View style={styles.pagerViewport}>
        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[styles.pager, { width: pageWidth * MODE_OPTIONS.length }, pagerStyle]}
          >
            {MODE_OPTIONS.map((option) => (
              <View key={option.value} style={{ width: pageWidth }}>
                <ActivityPage
                  mode={option.value}
                  isFocused={isFocused}
                  snapshotTime={snapshotTime}
                  setSnapshotTime={setSnapshotTime}
                  colors={colors}
                  styles={styles}
                />
              </View>
            ))}
          </Animated.View>
        </GestureDetector>
      </View>
      {/* Floats over whichever slice is on screen, so it goes after the pager. */}
      <CinevilleCardButton surface="activity" />
    </TopSafeAreaView>
  );
}

type ActivityPageProps = {
  mode: ActivityMode;
  isFocused: boolean;
  snapshotTime: string;
  setSnapshotTime: (snapshotTime: string) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
};

/**
 * One page of the pager: the feed for a single mode, with the query behind it.
 *
 * Each page runs its own query rather than the screen swapping one query's
 * arguments, because all three are on screen at once as far as the pager is
 * concerned — a page being dragged into view has to already hold its own feed.
 * The two `useFetch…` hooks are called unconditionally and one of them is left
 * disabled, since which page this is never changes for the life of the mount.
 */
function ActivityPage({
  mode,
  isFocused,
  snapshotTime,
  setSnapshotTime,
  colors,
  styles,
}: ActivityPageProps) {
  const router = useRouter();
  const isYou = mode === "you";
  const isFriendsOnly = mode === "friends";

  const filters = useMemo(
    () => ({
      selectedStatuses: [...ACTIVITY_STATUSES],
      friendsOnly: isFriendsOnly,
      allCinemas: true,
    }),
    [isFriendsOnly]
  );

  const mainQuery = useFetchMainPageShowtimes({
    limit: 20,
    snapshotTime,
    filters,
    enabled: isFocused && !isYou,
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
    enabled: isFocused && isYou,
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

  const { refreshing, handleRefresh } = useSnapshotRefresh({ setSnapshotTime, isFetching });

  // Distinguishes "you have no friends yet" from "your friends have nothing
  // on right now" — the empty state and its CTA differ between the two. Not
  // needed for "You", which has its own, friend-independent empty state.
  const { data: friends, isFetching: isFetchingFriends } = useFetchFriends({ enabled: !isYou });
  const hasFriends = (friends?.length ?? 0) > 0;
  const isLoadingFriends = isFetchingFriends && friends === undefined;

  const goToAddFriends = () => {
    triggerSelectionHaptic();
    router.push({ pathname: "/(tabs)/friends", params: { tab: "users" } });
  };

  const goToShowtimes = () => {
    triggerSelectionHaptic();
    router.push("/(tabs)");
  };

  const emptyText = isYou
    ? "Nothing in your agenda yet"
    : hasFriends
      ? "Nothing lined up right now"
      : "No friends yet";
  const browseShowtimesButton = (
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
  );
  const addFriendsButton = (
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
  );

  const emptyExtra = isYou ? (
    <View style={styles.emptyActionRow}>
      <ThemedText style={styles.emptyExtraText}>
        See what's playing and mark something you're going to.
      </ThemedText>
      {browseShowtimesButton}
    </View>
  ) : isLoadingFriends ? null : hasFriends ? (
    <View style={styles.emptyActionRow}>
      <ThemedText style={styles.emptyExtraText}>
        Nobody's marked a screening going or interested yet.
      </ThemedText>
      <View style={styles.emptyActionButtonRow}>
        {mode === "all" ? browseShowtimesButton : null}
        {addFriendsButton}
      </View>
    </View>
  ) : (
    <View style={styles.emptyActionRow}>
      <ThemedText style={styles.emptyExtraText}>
        Add friends to see what they're going to.
      </ThemedText>
      <View style={styles.emptyActionButtonRow}>
        {mode === "all" ? browseShowtimesButton : null}
        {addFriendsButton}
      </View>
    </View>
  );

  return (
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
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    modeRow: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
    },
    // The row of pages is wider than the screen, so the window it moves behind
    // has to clip it — on Android nothing else does.
    pagerViewport: { flex: 1, overflow: "hidden" },
    pager: { flex: 1, flexDirection: "row" },
    emptyActionRow: { alignItems: "center", gap: 4 },
    emptyActionButtonRow: { flexDirection: "row", gap: 10 },
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
    return <TabScreenSkeleton title="Activity" icon="bolt.fill" />;
  }
  return <ActivityScreen />;
}
