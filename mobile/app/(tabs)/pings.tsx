/**
 * Expo Router screen/module for (tabs) / pings. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useIsFocused } from "@react-navigation/native";
import {
  MeService,
  MoviesService,
  ShowtimesService,
  type GoingStatus,
  type CinemaPublic,
  type ShowtimeInMovieLoggedIn,
  type ShowtimePingPublic,
} from "shared";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchShowtimePings } from "shared/hooks/useFetchShowtimePings";

import FriendBadges from "@/components/badges/FriendBadges";
import CinemaPill from "@/components/badges/CinemaPill";
import FilterPills from "@/components/filters/FilterPills";
import TopBar from "@/components/layout/TopBar";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { createShowtimeStatusGlowStyles } from "@/components/showtimes/showtime-glow";
import ShowtimeActionModal from "@/components/showtimes/ShowtimeActionModal";
import {
  GLOBAL_LONG_PRESS_DELAY_MS,
  triggerLongPressHaptic,
} from "@/utils/long-press";
type PingSortMode = "ping-date" | "showtime-date";
type PingSortFilterId = "sort-mode";

type GroupedPingCard = {
  showtimeId: number;
  movieId: number;
  movieTitle: string;
  moviePosterLink: string | null;
  cinemaName: string;
  datetime: string;
  pingIds: number[];
  senders: ShowtimePingPublic["sender"][];
  latestPingCreatedAt: string;
  latestPingCreatedAtMs: number;
  showtimeDatetimeMs: number;
  hasUnseen: boolean;
};

const POSTER_HEIGHT = 112;
const normalizeCinemaName = (name: string) => name.trim().toLowerCase();

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
  const [selectedShowtime, setSelectedShowtime] = useState<ShowtimeInMovieLoggedIn | null>(null);
  const [selectedShowtimeMovieTitle, setSelectedShowtimeMovieTitle] = useState<string | null>(null);
  const suppressNextPressShowtimeIdRef = useRef<number | null>(null);
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

  const movieIds = useMemo(
    () => Array.from(new Set(activePings.map((ping) => ping.movie_id))),
    [activePings]
  );
  const { data: cinemas = [] } = useFetchCinemas();
  const cinemaByName = useMemo(() => {
    const map = new Map<string, CinemaPublic>();
    for (const cinema of cinemas) {
      map.set(normalizeCinemaName(cinema.name), cinema);
    }
    return map;
  }, [cinemas]);

  const movieDetailsQueries = useQueries({
    queries: movieIds.map((movieId) => ({
      queryKey: ["movie", movieId, "pingsShowtimeDetails"],
      queryFn: () =>
        MoviesService.readMovie({
          id: movieId,
          showtimeLimit: 1000,
        }),
      enabled: movieId > 0,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
    })),
  });

  const showtimeById = useMemo(() => {
    const map = new Map<number, ShowtimeInMovieLoggedIn>();
    for (const query of movieDetailsQueries) {
      const movie = query.data;
      if (!movie) continue;
      for (const showtime of movie.showtimes) {
        if (!map.has(showtime.id)) {
          map.set(showtime.id, showtime);
        }
      }
    }
    return map;
  }, [movieDetailsQueries]);

  const groupedPingCards = useMemo(() => {
    const grouped = new Map<number, GroupedPingCard>();

    for (const ping of activePings) {
      const createdAtMs = DateTime.fromISO(ping.created_at).toMillis();
      const showtimeMs = DateTime.fromISO(ping.datetime).toMillis();
      const existing = grouped.get(ping.showtime_id);

      if (!existing) {
        grouped.set(ping.showtime_id, {
          showtimeId: ping.showtime_id,
          movieId: ping.movie_id,
          movieTitle: ping.movie_title,
          moviePosterLink: ping.movie_poster_link,
          cinemaName: ping.cinema_name,
          datetime: ping.datetime,
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
    mutationFn: ({ showtimeId, going }: { showtimeId: number; going: GoingStatus }) =>
      ShowtimesService.updateShowtimeSelection({
        showtimeId,
        requestBody: {
          going_status: going,
        },
      }),
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
  const handleShowtimeStatusUpdate = (going: GoingStatus) => {
    if (!selectedShowtime || isUpdatingShowtimeSelection) return;
    setSelectedShowtime((previous) => (previous ? { ...previous, going } : previous));
    updateShowtimeSelection({ showtimeId: selectedShowtime.id, going });
  };

  const dismissPingGroup = (pingIds: number[]) => {
    if (pingIds.length === 0) return;
    deletePingsMutation.mutate({ pingIds });
  };

  const handleOpenPingMovie = (card: GroupedPingCard) => {
    if (suppressNextPressShowtimeIdRef.current === card.showtimeId) {
      suppressNextPressShowtimeIdRef.current = null;
      return;
    }
    router.push(`/movie/${card.movieId}`);
  };

  const handleOpenPingActions = (card: GroupedPingCard) => {
    const showtime = showtimeById.get(card.showtimeId);
    if (!showtime) {
      Alert.alert("Please wait", "Showtime details are still loading.");
      return;
    }
    triggerLongPressHaptic();
    suppressNextPressShowtimeIdRef.current = card.showtimeId;
    setSelectedShowtime(showtime);
    setSelectedShowtimeMovieTitle(card.movieTitle);
  };

  const handlePingCardPressOut = (showtimeId: number) => {
    if (suppressNextPressShowtimeIdRef.current !== showtimeId) return;
    // Clear right after the current gesture cycle to avoid slowing the next tap.
    requestAnimationFrame(() => {
      if (suppressNextPressShowtimeIdRef.current === showtimeId) {
        suppressNextPressShowtimeIdRef.current = null;
      }
    });
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
          const date = DateTime.fromISO(item.datetime);
          const weekday = date.toFormat("ccc");
          const day = date.toFormat("d");
          const month = date.toFormat("LLL");
          const time = date.toFormat("HH:mm");
          const latestPingTimestamp = DateTime.fromISO(item.latestPingCreatedAt).toFormat(
            "ccc, LLL d • HH:mm"
          );
          const showtime = showtimeById.get(item.showtimeId);
          const cinema =
            showtime?.cinema ?? cinemaByName.get(normalizeCinemaName(item.cinemaName));
          const cardStatusStyle =
            showtime?.going === "GOING"
              ? styles.cardGoing
              : showtime?.going === "INTERESTED"
                ? styles.cardInterested
                : undefined;
          const cardGlowStyle =
            showtime?.going === "GOING"
              ? styles.cardGlowGoing
              : showtime?.going === "INTERESTED"
                ? styles.cardGlowInterested
                : undefined;
          const dateColumnStatusStyle =
            showtime?.going === "GOING"
              ? styles.dateColumnGoing
              : showtime?.going === "INTERESTED"
                ? styles.dateColumnInterested
                : undefined;
          const senderNames = item.senders
            .map((sender) => sender.display_name?.trim() || "Friend")
            .filter((value, index, all) => all.indexOf(value) === index);
          const senderSummary =
            senderNames.length <= 1
              ? `Pinged by ${senderNames[0] ?? "Friend"}`
              : senderNames.length === 2
                ? `Pinged by ${senderNames[0]} and ${senderNames[1]}`
                : `Pinged by ${senderNames[0]} and ${senderNames.length - 1} others`;
          const statusLabel =
            showtime?.going === "GOING"
              ? "You're going"
              : showtime?.going === "INTERESTED"
                ? "You're interested"
                : "No response yet";

          return (
            <View style={styles.cardWrapper}>
              <TouchableOpacity
                onPress={() => handleOpenPingMovie(item)}
                onLongPress={() => handleOpenPingActions(item)}
                delayLongPress={GLOBAL_LONG_PRESS_DELAY_MS}
                onPressOut={() => handlePingCardPressOut(item.showtimeId)}
                activeOpacity={0.85}
              >
                <View style={[styles.cardGlow, cardGlowStyle]}>
                  <View style={[styles.card, cardStatusStyle, item.hasUnseen && styles.unseenCard]}>
                    <View style={[styles.dateColumn, dateColumnStatusStyle]}>
                      <ThemedText style={styles.weekday}>{weekday}</ThemedText>
                      <ThemedText style={styles.day}>{day}</ThemedText>
                      <ThemedText style={styles.month}>{month}</ThemedText>
                      <ThemedText style={styles.time}>{time}</ThemedText>
                    </View>
                    <Image source={{ uri: item.moviePosterLink ?? undefined }} style={styles.poster} />
                    <View style={styles.info}>
                      <View style={styles.titleRow}>
                        <ThemedText style={styles.movieTitle} numberOfLines={2} ellipsizeMode="tail">
                          {item.movieTitle}
                        </ThemedText>
                        {cinema ? (
                          <CinemaPill cinema={cinema} variant="compact" />
                        ) : (
                          <View style={styles.fallbackCinemaBadge}>
                            <ThemedText style={styles.fallbackCinemaText} numberOfLines={1}>
                              {item.cinemaName}
                            </ThemedText>
                          </View>
                        )}
                        {item.hasUnseen ? <View style={styles.unseenDot} /> : null}
                      </View>
                      <ThemedText
                        style={[
                          styles.statusText,
                          showtime?.going === "GOING"
                            ? styles.statusTextGoing
                            : showtime?.going === "INTERESTED"
                              ? styles.statusTextInterested
                              : undefined,
                        ]}
                        numberOfLines={1}
                      >
                        {statusLabel}
                      </ThemedText>
                      <FriendBadges
                        friendsGoing={showtime?.friends_going ?? []}
                        friendsInterested={showtime?.friends_interested ?? []}
                        variant="compact"
                        maxVisible={2}
                        style={styles.friendRow}
                      />
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
              <View style={styles.metaRow}>
                <View style={styles.metaTextGroup}>
                  <ThemedText style={styles.metaText} numberOfLines={1}>
                    {senderSummary}
                  </ThemedText>
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

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) => {
  const glowStyles = createShowtimeStatusGlowStyles(colors);
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 16,
      paddingBottom: 24,
    },
    cardWrapper: {
      marginBottom: 16,
    },
    cardGlow: {
      borderRadius: 12,
      backgroundColor: colors.cardBackground,
    },
    cardGlowGoing: glowStyles.going,
    cardGlowInterested: glowStyles.interested,
    card: {
      flexDirection: "row",
      overflow: "hidden",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      height: POSTER_HEIGHT,
    },
    cardGoing: {
      borderColor: colors.green.secondary,
      backgroundColor: colors.green.primary,
    },
    cardInterested: {
      borderColor: colors.orange.secondary,
      backgroundColor: colors.orange.primary,
    },
    unseenCard: {
      borderColor: colors.tint,
    },
    dateColumn: {
      width: 56,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.pillBackground,
      borderRightWidth: 1,
      borderRightColor: colors.cardBorder,
      paddingVertical: 8,
      gap: 2,
    },
    dateColumnGoing: {
      backgroundColor: colors.green.primary,
      borderRightColor: colors.green.secondary,
    },
    dateColumnInterested: {
      backgroundColor: colors.orange.primary,
      borderRightColor: colors.orange.secondary,
    },
    weekday: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    day: {
      fontSize: 24,
      fontWeight: "800",
      color: colors.text,
      lineHeight: 26,
    },
    month: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    time: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.text,
    },
    poster: {
      width: 72,
      height: "100%",
      backgroundColor: colors.posterPlaceholder,
    },
    info: {
      flex: 1,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 4,
      overflow: "hidden",
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      columnGap: 6,
      flexWrap: "nowrap",
    },
    movieTitle: {
      fontSize: Platform.OS === "ios" ? 14 : 15,
      lineHeight: Platform.OS === "ios" ? 16 : 17,
      fontWeight: "700",
      color: colors.text,
      flex: 1,
      minWidth: 0,
    },
    unseenDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.notificationBadge,
    },
    fallbackCinemaBadge: {
      borderWidth: 1,
      borderColor: colors.blue.secondary,
      borderRadius: 3,
      backgroundColor: colors.blue.primary,
      minHeight: 14,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 5,
      maxWidth: "65%",
    },
    fallbackCinemaText: {
      fontSize: 9,
      lineHeight: 10,
      color: colors.blue.secondary,
      includeFontPadding: false,
    },
    friendRow: {
      marginTop: 2,
    },
    statusText: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    statusTextGoing: {
      color: colors.green.secondary,
      fontWeight: "700",
    },
    statusTextInterested: {
      color: colors.orange.secondary,
      fontWeight: "700",
    },
    metaRow: {
      marginTop: 6,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    metaTextGroup: {
      flex: 1,
      minWidth: 0,
    },
    metaText: {
      fontSize: 12,
      color: colors.textSecondary,
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
    statusModalBackdrop: {
      flex: 1,
      justifyContent: "center",
      padding: 20,
    },
    statusModalBlur: {
      ...StyleSheet.absoluteFillObject,
    },
    statusModalTint: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.06)",
    },
    statusModalDismissArea: {
      ...StyleSheet.absoluteFillObject,
    },
    statusModalCard: {
      backgroundColor: colors.cardBackground,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 14,
      gap: 10,
    },
    statusModalTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
    },
    statusModalSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    ticketButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.tint,
      backgroundColor: colors.cardBackground,
      alignItems: "center",
      paddingVertical: 9,
      paddingHorizontal: 12,
    },
    ticketButtonDisabled: {
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
    },
    ticketButtonText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.tint,
    },
    ticketButtonTextDisabled: {
      color: colors.textSecondary,
    },
    statusButtons: {
      gap: 8,
      marginTop: 4,
    },
    statusButton: {
      borderRadius: 10,
      borderWidth: 1,
      paddingVertical: 10,
      paddingHorizontal: 12,
      alignItems: "center",
    },
    statusButtonGoing: {
      backgroundColor: colors.green.primary,
      borderColor: colors.green.secondary,
    },
    statusButtonInterested: {
      backgroundColor: colors.orange.primary,
      borderColor: colors.orange.secondary,
    },
    statusButtonNotGoing: {
      backgroundColor: colors.red.primary,
      borderColor: colors.red.secondary,
    },
    statusButtonActive: {
      borderWidth: 3,
      shadowColor: colors.text,
      shadowOpacity: 0.28,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 7,
      transform: [{ scale: 1.02 }],
    },
    statusButtonText: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
    },
    statusButtonTextActive: {
      fontWeight: "800",
    },
    statusCancelButton: {
      alignItems: "center",
      paddingTop: 2,
    },
    statusCancelText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    pingToggleButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.tint,
      backgroundColor: colors.cardBackground,
      alignItems: "center",
      paddingVertical: 9,
      paddingHorizontal: 12,
    },
    pingToggleText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.tint,
    },
    pingList: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 10,
      padding: 10,
      gap: 8,
      backgroundColor: colors.pillBackground,
    },
    pingListHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    pingListTitle: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    pingListScroll: {
      maxHeight: 240,
    },
    pingListContent: {
      gap: 8,
    },
    pingListEmpty: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    pingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 8,
      paddingVertical: 7,
    },
    pingFriendIdentity: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    pingFriendAvatar: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.pillBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    pingFriendAvatarText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.text,
    },
    pingFriendMeta: {
      flex: 1,
      gap: 2,
    },
    pingFriendName: {
      flex: 1,
      fontSize: 13,
      color: colors.text,
    },
    pingFriendStatus: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    pingButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.tint,
      paddingVertical: 5,
      paddingHorizontal: 11,
      backgroundColor: colors.cardBackground,
    },
    pingButtonDisabled: {
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
    },
    pingButtonText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.tint,
    },
    pingButtonTextDisabled: {
      color: colors.textSecondary,
    },
  });
};
