/**
 * Expo Router screen/module for (tabs) / pings. It controls navigation and screen-level state for this route.
 */
import { useEffect } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useIsFocused } from "@react-navigation/native";
import { MeService } from "shared";
import { useFetchShowtimePings } from "shared/hooks/useFetchShowtimePings";

import TopBar from "@/components/layout/TopBar";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

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

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TopBar title="Pings" />
      <FlatList
        data={pings}
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
          const showtimeLabel = DateTime.fromISO(item.datetime).toFormat("ccc, LLL d, HH:mm");
          return (
            <Pressable
              style={[styles.card, !item.seen_at && styles.unseenCard]}
              onPress={() => router.push(`/movie/${item.movie_id}`)}
            >
              <View style={styles.cardHeader}>
                <ThemedText style={styles.movieTitle}>{item.movie_title}</ThemedText>
                {!item.seen_at ? <View style={styles.unseenDot} /> : null}
              </View>
              <ThemedText style={styles.metaText}>
                {showtimeLabel} • {item.cinema_name}
              </ThemedText>
              <ThemedText style={styles.metaText}>
                Pinged by {item.sender.display_name ?? "Friend"}
              </ThemedText>
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
      gap: 12,
      paddingBottom: 24,
    },
    card: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 4,
    },
    unseenCard: {
      borderColor: colors.tint,
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    movieTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.text,
      flex: 1,
    },
    unseenDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.notificationBadge,
    },
    metaText: {
      fontSize: 12,
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
