/**
 * Expo Router screen/module for (tabs) / agenda. Shows the user's personal agenda:
 * showtimes they are going to / interested in, plus showtimes they've been invited
 * to. Interested + invites can be toggled on/off; going is always shown.
 */
import { useEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import { MeService } from "shared";
import { useFetchAgenda } from "shared/hooks/useFetchAgenda";

import TopBar from "@/components/layout/TopBar";
import FilterPills from "@/components/filters/FilterPills";
import { ShowtimesListContent } from "@/components/showtimes/ShowtimesScreen";
import { useThemeColors } from "@/hooks/use-theme-color";
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from "@/utils/reset-infinite-query";

type AgendaToggleId = "interested" | "invites";

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

  // Mark received invites as seen as soon as the agenda is viewed, clearing the badge.
  const markSeenMutation = useMutation({
    mutationFn: () => MeService.markMyShowtimePingsSeen(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings", "unseenCount"] });
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] });
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

  const toggleFilters = useMemo(
    () => [
      {
        id: "interested" as const,
        label: "Interested",
        activeBackgroundColor: colors.orange.primary,
        activeTextColor: colors.orange.secondary,
      },
      {
        id: "invites" as const,
        label: "Invites",
        activeBackgroundColor: colors.blue.primary,
        activeTextColor: colors.blue.secondary,
      },
    ],
    [colors]
  );

  const activeToggleIds = useMemo(() => {
    const ids: AgendaToggleId[] = [];
    if (includeInterested) ids.push("interested");
    if (includeInvited) ids.push("invites");
    return ids;
  }, [includeInterested, includeInvited]);

  const handleToggle = (id: AgendaToggleId) => {
    if (id === "interested") setIncludeInterested((previous) => !previous);
    else setIncludeInvited((previous) => !previous);
  };

  const emptyText =
    !includeInterested && !includeInvited
      ? "No showtimes you're going to yet"
      : "Nothing in your agenda yet";

  // Render/output using the state and derived values prepared above.
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TopBar title="Agenda" />
      <FilterPills<AgendaToggleId>
        filters={toggleFilters}
        selectedId=""
        activeIds={activeToggleIds}
        onSelect={handleToggle}
      />
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
    </SafeAreaView>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
  });
