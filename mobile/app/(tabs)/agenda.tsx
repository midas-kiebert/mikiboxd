/**
 * Expo Router screen/module for (tabs) / agenda. Shows the user's personal agenda:
 * showtimes they are going to / interested in, plus showtimes they've been invited
 * to. Interested + invites can be toggled on/off; going is always shown.
 */
import { useEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import TopSafeAreaView from "@/components/layout/TopSafeAreaView";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import { MeService } from "shared";
import { useFetchAgenda } from "shared/hooks/useFetchAgenda";
import { useFetchShowtimePings } from "shared/hooks/useFetchShowtimePings";

import TopBar from "@/components/layout/TopBar";
import { ShowtimesListContent } from "@/components/showtimes/ShowtimesScreen";
import AgendaTogglePill, { AgendaToggleRow } from "@/components/showtimes/AgendaTogglePill";
import { useThemeColors } from "@/hooks/use-theme-color";
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from "@/utils/reset-infinite-query";

type ThemeColors = typeof import("@/constants/theme").Colors.light;

export default function AgendaScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
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
    enabled: isFocused,
  });

  const showtimes = useMemo(() => data?.pages.flat() ?? [], [data]);

  const { data: pendingPings } = useFetchShowtimePings({
    limit: 1,
    enabled: isFocused,
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
    if (!isFocused) return;
    markSeenMutation.mutate();
    // Trigger once when this tab gains focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshInfiniteQueryWithFreshSnapshot({
        queryClient,
        queryKey: ["showtimes", "agenda", { includeInterested, includeInvited }],
        setSnapshotTime,
      });
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
  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar title="Agenda" />
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
    </TopSafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
  });
