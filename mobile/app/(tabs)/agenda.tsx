/**
 * Expo Router screen/module for (tabs) / agenda. Shows the user's personal agenda:
 * showtimes they are going to / interested in, plus showtimes they've been invited
 * to. Interested + invites can be toggled on/off; going is always shown.
 */
import { useEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import TopSafeAreaView from "@/components/layout/TopSafeAreaView";
import TabScreenSkeleton from "@/components/layout/TabScreenSkeleton";
import { tabContentHoldMs } from "@/components/tab-bar";
import { useDeferredMount } from "@/utils/use-deferred-mount";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import { MeService } from "shared";
import { useFetchAgenda } from "shared/hooks/useFetchAgenda";
import { useFetchShowtimePings } from "shared/hooks/useFetchShowtimePings";

import TopBar from "@/components/layout/TopBar";
import SignedOutPanel from "@/components/auth/SignedOutPanel";
import CinevilleCardButton from "@/components/cineville/CinevilleCardButton";
import { ShowtimesListContent } from "@/components/showtimes/ShowtimesScreen";
import AgendaTogglePill, { AgendaToggleRow } from "@/components/showtimes/AgendaTogglePill";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useIsSignedIn } from "@/utils/auth-session";
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from "@/utils/reset-infinite-query";

/** What signing in would put on this tab, in the order it would appear. */
const AGENDA_HIGHLIGHTS = [
  "The screenings you said you're interested in",
  "The screenings you are going to",
  "Invites your friends send you"
] as const;

type ThemeColors = typeof import("@/constants/theme").Colors.light;

function AgendaScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  // An agenda is a list of what *you* are going to, so there is nothing here to
  // render for a guest — and nothing to fetch either. The tab stays in the bar
  // rather than vanishing: it is where a guest finds out what an account is for.
  const isSignedIn = useIsSignedIn();
  const [includeInterested, setIncludeInterested] = useState(true);
  const [includeInvited, setIncludeInvited] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useFetchAgenda({
    limit: 20,
    snapshotTime,
    includeInterested,
    includeInvited,
    enabled: isFocused && isSignedIn,
  });

  const showtimes = useMemo(() => data?.pages.flat() ?? [], [data]);

  const { data: pendingPings } = useFetchShowtimePings({
    limit: 1,
    enabled: isFocused && isSignedIn,
    refetchIntervalMs: false,
  });
  const hasAnyInvites = (pendingPings?.length ?? 0) > 0;

  // Mark received invites as seen as soon as the agenda is viewed, clearing the badge.
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
    if (!isFocused || !isSignedIn) return;
    markSeenMutation.mutate();
    // Trigger once when this tab gains focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, isSignedIn]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshInfiniteQueryWithFreshSnapshot({ setSnapshotTime });
    } finally {
      setRefreshing(false);
    }
  };

  const toggleInterested = () => setIncludeInterested((previous) => !previous);

  const toggleInvited = () => setIncludeInvited((previous) => !previous);

  const emptyText =
    !includeInterested && !includeInvited
      ? "No showtimes you're going to yet"
      : "Nothing in your agenda yet";

  // Render/output using the state and derived values prepared above.
  if (!isSignedIn) {
    return (
      <TopSafeAreaView style={styles.container}>
        <TopBar title="Agenda" icon="calendar" />
        <SignedOutPanel feature="agenda" bullets={AGENDA_HIGHLIGHTS} />
        {/* The Cineville pass is stored on the device, so it is just as usable
            without an account as with one. */}
        <CinevilleCardButton surface="agenda" />
      </TopSafeAreaView>
    );
  }

  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar title="Agenda" icon="calendar" />
      <AgendaToggleRow>
        <AgendaTogglePill
          label="Interested"
          iconOn="bookmark"
          iconOff="bookmark-border"
          active={includeInterested}
          accent={colors.orange}
          onToggle={toggleInterested}
        />
        {hasAnyInvites ? (
          <AgendaTogglePill
            label="Invites"
            iconOn="mail"
            iconOff="mail-outline"
            active={includeInvited}
            accent={colors.blue}
            onToggle={toggleInvited}
          />
        ) : null}
      </AgendaToggleRow>
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
      />
      {/* Last, so it floats over the list rather than under it. */}
      <CinevilleCardButton surface="agenda" />
    </TopSafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
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
export default function AgendaScreenTab() {
  const ready = useDeferredMount("tab:agenda", tabContentHoldMs);
  if (!ready) return <TabScreenSkeleton title="Agenda" icon="calendar" rowHeight={112} />;
  return <AgendaScreen />;
}
