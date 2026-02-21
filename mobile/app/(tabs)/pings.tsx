/**
 * Expo Router screen/module for (tabs) / pings. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
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
import { MeService, MoviesService, type ShowtimeInMovieLoggedIn } from "shared";
import { useFetchShowtimePings } from "shared/hooks/useFetchShowtimePings";

import CinemaPill from "@/components/badges/CinemaPill";
import FriendBadges from "@/components/badges/FriendBadges";
import TopBar from "@/components/layout/TopBar";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

const POSTER_HEIGHT = 112;

export default function PingsScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();

  const {
    data: pings = [],
    isLoading,
    isFetching,
    refetch,
  } = useFetchShowtimePings({ refetchIntervalMs: 15000 });
  const [dismissedPingIds, setDismissedPingIds] = useState<Set<number>>(new Set());

  const movieIds = useMemo(
    () => Array.from(new Set(pings.map((ping) => ping.movie_id))),
    [pings]
  );

  const movieDetailsQueries = useQueries({
    queries: movieIds.map((movieId) => ({
      queryKey: ["movie", movieId, "pingsShowtimeDetails"],
      queryFn: () =>
        MoviesService.readMovie({
          id: movieId,
          showtimeLimit: 200,
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

  const visiblePings = useMemo(
    () => pings.filter((ping) => !dismissedPingIds.has(ping.id)),
    [dismissedPingIds, pings]
  );

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

  // Mark pings as seen as soon as this tab is viewed.
  useEffect(() => {
    if (!isFocused) return;
    markSeenMutation.mutate();
    // Trigger once when this tab gains focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  const dismissPing = (pingId: number) => {
    setDismissedPingIds((previous) => {
      const next = new Set(previous);
      next.add(pingId);
      return next;
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TopBar title="Pings" />
      <FlatList
        data={visiblePings}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} />}
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
          const showtime = showtimeById.get(item.showtime_id);
          const cinema = showtime?.cinema;
          const friendsGoing = showtime?.friends_going ?? [];
          const friendsInterested = showtime?.friends_interested ?? [];
          const senderName = item.sender.display_name?.trim() || "Friend";
          return (
            <Pressable
              style={styles.cardWrapper}
              onPress={() => router.push(`/movie/${item.movie_id}`)}
            >
              <View style={[styles.card, !item.seen_at && styles.unseenCard]}>
                <View style={styles.dateColumn}>
                  <ThemedText style={styles.weekday}>{weekday}</ThemedText>
                  <ThemedText style={styles.day}>{day}</ThemedText>
                  <ThemedText style={styles.month}>{month}</ThemedText>
                  <ThemedText style={styles.time}>{time}</ThemedText>
                </View>
                <Image
                  source={{ uri: item.movie_poster_link ?? undefined }}
                  style={styles.poster}
                />
                <View style={styles.info}>
                  <View style={styles.titleRow}>
                    <ThemedText style={styles.movieTitle} numberOfLines={1} ellipsizeMode="tail">
                      {item.movie_title}
                    </ThemedText>
                    {cinema ? (
                      <CinemaPill cinema={cinema} variant="compact" />
                    ) : (
                      <View style={styles.fallbackCinemaBadge}>
                        <ThemedText style={styles.fallbackCinemaText} numberOfLines={1}>
                          {item.cinema_name}
                        </ThemedText>
                      </View>
                    )}
                    {!item.seen_at ? <View style={styles.unseenDot} /> : null}
                  </View>
                  <FriendBadges
                    friendsGoing={friendsGoing}
                    friendsInterested={friendsInterested}
                    variant="compact"
                    style={styles.friendRow}
                  />
                  <ThemedText style={styles.metaText}>Pinged by {senderName}</ThemedText>
                  <TouchableOpacity
                    style={styles.dismissButton}
                    onPress={(event) => {
                      event.stopPropagation();
                      dismissPing(item.id);
                    }}
                    activeOpacity={0.8}
                  >
                    <ThemedText style={styles.dismissButtonText}>Dismiss</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            </Pressable>
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
      gap: 16,
      paddingBottom: 24,
    },
    cardWrapper: {
      marginBottom: 0,
    },
    card: {
      flexDirection: "row",
      overflow: "hidden",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      minHeight: POSTER_HEIGHT,
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
      height: POSTER_HEIGHT,
      backgroundColor: colors.posterPlaceholder,
    },
    info: {
      flex: 1,
      paddingHorizontal: 10,
      paddingVertical: 6,
      gap: 6,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      columnGap: 6,
      rowGap: 4,
      flexWrap: "wrap",
    },
    movieTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.text,
      flexShrink: 0,
      maxWidth: "100%",
    },
    unseenDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.notificationBadge,
    },
    fallbackCinemaBadge: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 2,
      backgroundColor: colors.pillBackground,
      height: 12,
      justifyContent: "center",
      paddingHorizontal: 5,
      maxWidth: "65%",
    },
    fallbackCinemaText: {
      fontSize: 9,
      lineHeight: 12,
      color: colors.textSecondary,
    },
    friendRow: {
      marginTop: 3,
    },
    metaText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    dismissButton: {
      alignSelf: "flex-start",
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
