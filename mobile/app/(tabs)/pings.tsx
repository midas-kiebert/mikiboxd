/**
 * Expo Router screen/module for (tabs) / pings. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useIsFocused } from "@react-navigation/native";
import {
  MeService,
  ShowtimesService,
  type GoingStatus,
  type ShowtimeLoggedIn,
  type ShowtimePingPublic,
} from "shared";
import { useFetchShowtimePings } from "shared/hooks/useFetchShowtimePings";

import FilterPills from "@/components/filters/FilterPills";
import TopBar from "@/components/layout/TopBar";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import ShowtimeActionModal from "@/components/showtimes/ShowtimeActionModal";
import ShowtimeCard from "@/components/showtimes/ShowtimeCard";

type PingSortMode = "ping-date" | "showtime-date";
type PingSortFilterId = "sort-mode";

type GroupedPingCard = {
  showtimeId: number;
  showtime: ShowtimeLoggedIn;
  pingIds: number[];
  senders: ShowtimePingPublic["sender"][];
  latestPingCreatedAt: string;
  latestPingCreatedAtMs: number;
  showtimeDatetimeMs: number;
  hasUnseen: boolean;
};

export default function PingsScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const [sortMode, setSortMode] = useState<PingSortMode>("ping-date");
  const [hiddenPingIds, setHiddenPingIds] = useState<Set<number>>(new Set());
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [selectedShowtime, setSelectedShowtime] = useState<ShowtimeLoggedIn | null>(null);
  const [selectedShowtimeMovieTitle, setSelectedShowtimeMovieTitle] = useState<string | null>(null);
  const backendSortBy = sortMode === "ping-date" ? "ping_created_at" : "showtime_datetime";

  const {
    data: pings = [],
    isLoading,
    refetch,
  } = useFetchShowtimePings({ refetchIntervalMs: 15000, sortBy: backendSortBy });
  const activePings = useMemo(
    () => pings.filter((ping) => !hiddenPingIds.has(ping.id)),
    [hiddenPingIds, pings]
  );

  const groupedPingCards = useMemo(() => {
    const grouped = new Map<number, GroupedPingCard>();

    for (const ping of activePings) {
      const createdAtMs = DateTime.fromISO(ping.created_at).toMillis();
      const showtimeMs = DateTime.fromISO(ping.showtime.datetime).toMillis();
      const existing = grouped.get(ping.showtime_id);

      if (!existing) {
        grouped.set(ping.showtime_id, {
          showtimeId: ping.showtime_id,
          showtime: ping.showtime,
          pingIds: [ping.id],
          senders: [ping.sender],
          latestPingCreatedAt: ping.created_at,
          latestPingCreatedAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
          showtimeDatetimeMs: Number.isFinite(showtimeMs) ? showtimeMs : 0,
          hasUnseen: ping.seen_at === null,
        });
        continue;
      }

      existing.pingIds.push(ping.id);
      if (!existing.senders.some((sender) => sender.id === ping.sender.id)) {
        existing.senders.push(ping.sender);
      }

      if (Number.isFinite(createdAtMs) && createdAtMs > existing.latestPingCreatedAtMs) {
        existing.latestPingCreatedAtMs = createdAtMs;
        existing.latestPingCreatedAt = ping.created_at;
      }

      if (ping.seen_at === null) {
        existing.hasUnseen = true;
      }
    }

    const cards = Array.from(grouped.values());
    if (sortMode === "showtime-date") {
      cards.sort((left, right) => {
        if (left.showtimeDatetimeMs !== right.showtimeDatetimeMs) {
          return left.showtimeDatetimeMs - right.showtimeDatetimeMs;
        }
        return right.latestPingCreatedAtMs - left.latestPingCreatedAtMs;
      });
    }
    return cards;
  }, [activePings, sortMode]);

  const markSeenMutation = useMutation({
    mutationFn: () => MeService.markMyShowtimePingsSeen(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings", "unseenCount"] });
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] });
    },
    onError: (error) => {
      console.error("Error marking showtime pings as seen:", error);
    },
  });

  const deletePingsMutation = useMutation({
    mutationFn: async ({ pingIds }: { pingIds: number[] }) => {
      for (const pingId of pingIds) {
        try {
          await MeService.deleteMyShowtimePing({ pingId });
        } catch (error) {
          const status =
            typeof error === "object" &&
            error !== null &&
            "status" in error &&
            typeof (error as { status?: unknown }).status === "number"
              ? (error as { status: number }).status
              : undefined;
          if (status === 404) {
            continue;
          }
          throw error;
        }
      }
    },
    onMutate: ({ pingIds }) => {
      setHiddenPingIds((previous) => {
        const next = new Set(previous);
        pingIds.forEach((pingId) => next.add(pingId));
        return next;
      });
      return { pingIds };
    },
    onError: (error, _variables, context) => {
      const pingIds = context?.pingIds ?? [];
      if (pingIds.length > 0) {
        setHiddenPingIds((previous) => {
          const next = new Set(previous);
          pingIds.forEach((pingId) => next.delete(pingId));
          return next;
        });
      }

      console.error("Error deleting showtime ping:", error);
      Alert.alert("Error", "Could not dismiss ping.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings", "unseenCount"] });
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] });
    },
  });

  // Mark pings as seen as soon as this tab is viewed.
  useEffect(() => {
    if (!isFocused) return;
    markSeenMutation.mutate();
    // Trigger once when this tab gains focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  const { mutate: updateShowtimeSelection, isPending: isUpdatingShowtimeSelection } = useMutation({
    mutationFn: ({
      showtimeId,
      going,
      seatRow,
      seatNumber,
    }: {
      showtimeId: number;
      going: GoingStatus;
      seatRow?: string | null;
      seatNumber?: string | null;
    }) => {
      const requestBody: {
        going_status: GoingStatus;
        seat_row?: string | null;
        seat_number?: string | null;
      } = {
        going_status: going,
      };
      if (seatRow !== undefined) {
        requestBody.seat_row = seatRow;
      }
      if (seatNumber !== undefined) {
        requestBody.seat_number = seatNumber;
      }
      return ShowtimesService.updateShowtimeSelection({
        showtimeId,
        requestBody,
      });
    },
    onSuccess: (updatedShowtime) => {
      setSelectedShowtime((previous) =>
        previous && previous.id === updatedShowtime.id ? updatedShowtime : previous
      );
    },
    onError: (error) => {
      console.error("Error updating showtime selection:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["showtimes"] });
      queryClient.invalidateQueries({ queryKey: ["movie"] });
      queryClient.invalidateQueries({ queryKey: ["movies"] });
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] });
    },
  });

  // Submit the selected going/interested/not-going status.
  const handleShowtimeStatusUpdate = (
    going: GoingStatus,
    seat?: { seatRow: string | null; seatNumber: string | null }
  ) => {
    if (!selectedShowtime || isUpdatingShowtimeSelection) return;
    const nextSeatRow =
      going === "GOING"
        ? (seat?.seatRow ?? selectedShowtime.seat_row ?? null)
        : null;
    const nextSeatNumber =
      going === "GOING"
        ? (seat?.seatNumber ?? selectedShowtime.seat_number ?? null)
        : null;
    setSelectedShowtime((previous) =>
      previous
        ? {
            ...previous,
            going,
            seat_row: nextSeatRow,
            seat_number: nextSeatNumber,
          }
        : previous
    );
    updateShowtimeSelection({
      showtimeId: selectedShowtime.id,
      going,
      seatRow: seat?.seatRow,
      seatNumber: seat?.seatNumber,
    });
  };

  const dismissPingGroup = (pingIds: number[]) => {
    if (pingIds.length === 0) return;
    deletePingsMutation.mutate({ pingIds });
  };

  const handleOpenPingMovie = (card: GroupedPingCard) => {
    router.push(`/movie/${card.showtime.movie.id}`);
  };

  const handleOpenPingActions = (showtime: ShowtimeLoggedIn) => {
    setSelectedShowtime(showtime);
    setSelectedShowtimeMovieTitle(showtime.movie.title);
  };

  const handleRefresh = () => {
    setIsManualRefreshing(true);
    void refetch().finally(() => {
      setIsManualRefreshing(false);
    });
  };

  const sortFilters = useMemo(
    () => [
      {
        id: "sort-mode" as const,
        label: sortMode === "ping-date" ? "Sort By Ping Date" : "Sort By Showtime Date",
      },
    ],
    [sortMode]
  );

  // Render/output using the state and derived values prepared above.
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TopBar title="Pings" />
      <FilterPills<PingSortFilterId>
        filters={sortFilters}
        selectedId=""
        onSelect={() =>
          setSortMode((previous) =>
            previous === "ping-date" ? "showtime-date" : "ping-date"
          )
        }
        activeIds={["sort-mode"]}
      />
      <ShowtimeActionModal
        visible={selectedShowtime !== null}
        showtime={selectedShowtime}
        movieTitle={selectedShowtimeMovieTitle ?? ""}
        isUpdatingStatus={isUpdatingShowtimeSelection}
        onUpdateStatus={handleShowtimeStatusUpdate}
        onClose={() => {
          setSelectedShowtime(null);
          setSelectedShowtimeMovieTitle(null);
        }}
      />
      <FlatList
        data={groupedPingCards}
        keyExtractor={(item) => item.showtimeId.toString()}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isManualRefreshing} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={colors.tint} />
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <ThemedText style={styles.emptyTitle}>No pings yet</ThemedText>
              <ThemedText style={styles.emptyText}>
                When friends ping you for a showtime, it will show up here.
              </ThemedText>
            </View>
          )
        }
        renderItem={({ item }) => {
          const latestPingTimestamp = DateTime.fromISO(item.latestPingCreatedAt).toFormat(
            "ccc, LLL d • HH:mm"
          );
          const senderNames = item.senders
            .map((sender) => sender.display_name?.trim() || "Friend")
            .filter((value, index, all) => all.indexOf(value) === index);
          const senderSummary =
            senderNames.length <= 1
              ? `Pinged by ${senderNames[0] ?? "Friend"}`
              : senderNames.length === 2
                ? `Pinged by ${senderNames[0]} and ${senderNames[1]}`
                : `Pinged by ${senderNames[0]} and ${senderNames.length - 1} others`;

          return (
            <View style={styles.cardWrapper}>
              <ShowtimeCard
                showtime={item.showtime}
                onPress={() => handleOpenPingMovie(item)}
                onLongPress={handleOpenPingActions}
              />
              <View style={styles.metaRow}>
                <View style={styles.metaTextGroup}>
                  <View style={styles.metaTitleRow}>
                    <ThemedText style={styles.metaText} numberOfLines={1}>
                      {senderSummary}
                    </ThemedText>
                    {item.hasUnseen ? <View style={styles.unseenDot} /> : null}
                  </View>
                  <ThemedText style={styles.metaTimestamp} numberOfLines={1}>
                    Latest ping: {latestPingTimestamp}
                  </ThemedText>
                </View>
                <TouchableOpacity
                  style={styles.dismissButton}
                  onPress={() => dismissPingGroup(item.pingIds)}
                  disabled={deletePingsMutation.isPending}
                  activeOpacity={0.8}
                >
                  <ThemedText style={styles.dismissButtonText}>Dismiss</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 16,
      paddingBottom: 24,
    },
    cardWrapper: {
      marginBottom: 12,
    },
    metaRow: {
      marginTop: -6,
      marginBottom: 6,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 4,
    },
    metaTextGroup: {
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    metaTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    unseenDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.notificationBadge,
      marginTop: 1,
    },
    metaText: {
      fontSize: 12,
      color: colors.textSecondary,
      flexShrink: 1,
    },
    metaTimestamp: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    dismissButton: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 8,
      backgroundColor: colors.pillBackground,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    dismissButtonText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    centerContainer: {
      paddingVertical: 40,
      alignItems: "center",
    },
    emptyCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      padding: 14,
      gap: 4,
      alignItems: "center",
    },
    emptyTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.text,
    },
    emptyText: {
      fontSize: 12,
      color: colors.textSecondary,
      textAlign: "center",
    },
  });
