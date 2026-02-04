import { useMemo } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import type { MovieLoggedIn } from "shared";
import { MoviesService } from "shared";
import { useFetchMovieShowtimes } from "shared/hooks/useFetchMovieShowtimes";

import { ThemedText } from "@/components/themed-text";
import ShowtimeRow from "@/components/showtimes/ShowtimeRow";
import { useThemeColors } from "@/hooks/use-theme-color";

const SHOWTIMES_PAGE_SIZE = 20;

export default function MoviePage() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { id } = useLocalSearchParams<{ id: string }>();

  const movieId = useMemo(() => Number(id), [id]);
  const snapshotTime = useMemo(
    () => DateTime.now().setZone("Europe/Amsterdam").toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    []
  );

  const { data: movie, isLoading: isMovieLoading, isError: isMovieError } = useQuery<MovieLoggedIn, Error>({
    queryKey: ["movie", movieId],
    queryFn: () => MoviesService.readMovie({ id: movieId, snapshotTime, showtimeLimit: 0 }),
    enabled: Number.isFinite(movieId) && movieId > 0,
  });

  const {
    data: showtimesData,
    isLoading: isShowtimesLoading,
    isError: isShowtimesError,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useFetchMovieShowtimes({
    movieId,
    limit: SHOWTIMES_PAGE_SIZE,
    snapshotTime,
  });

  const showtimes = useMemo(() => showtimesData?.pages.flat() ?? [], [showtimesData]);

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Stack.Screen options={{ title: movie?.title ?? "Movie" }} />
      {isMovieLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      ) : isMovieError || !movie ? (
        <View style={styles.centered}>
          <ThemedText style={styles.errorText}>Could not load movie.</ThemedText>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Image source={{ uri: movie.poster_link ?? undefined }} style={styles.poster} />
            <View style={styles.headerInfo}>
              <ThemedText style={styles.title}>{movie.title}</ThemedText>
              {movie.original_title ? (
                <ThemedText style={styles.subtitle}>{movie.original_title}</ThemedText>
              ) : null}
              {movie.directors && movie.directors.length > 0 ? (
                <ThemedText style={styles.meta}>Directed by {movie.directors.join(", ")}</ThemedText>
              ) : null}
              {movie.release_year ? (
                <ThemedText style={styles.meta}>{movie.release_year}</ThemedText>
              ) : null}
            </View>
          </View>

          <ThemedText style={styles.sectionTitle}>Showtimes</ThemedText>
          {isShowtimesLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.tint} />
            </View>
          ) : isShowtimesError ? (
            <ThemedText style={styles.errorText}>Could not load showtimes.</ThemedText>
          ) : showtimes.length === 0 ? (
            <ThemedText style={styles.noShowtimes}>No upcoming showtimes</ThemedText>
          ) : (
            showtimes.map((showtime) => (
              <View key={showtime.id} style={styles.showtimeCard}>
                <ShowtimeRow showtime={showtime} showFriends />
              </View>
            ))
          )}
          {hasNextPage ? (
            <TouchableOpacity
              style={styles.loadMore}
              onPress={handleLoadMore}
              disabled={isFetchingNextPage}
            >
              <ThemedText style={styles.loadMoreText}>
                {isFetchingNextPage ? "Loading..." : "Load more showtimes"}
              </ThemedText>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}
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
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    loadingContainer: {
      paddingVertical: 16,
      alignItems: "center",
    },
    errorText: {
      color: colors.textSecondary,
    },
    header: {
      flexDirection: "row",
      gap: 16,
      alignItems: "flex-start",
    },
    poster: {
      width: 120,
      height: 180,
      borderRadius: 8,
      backgroundColor: colors.posterPlaceholder,
    },
    headerInfo: {
      flex: 1,
      gap: 6,
    },
    title: {
      fontSize: 22,
      fontWeight: "700",
      color: colors.text,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    meta: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
    noShowtimes: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    showtimeCard: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 10,
      padding: 10,
      backgroundColor: colors.cardBackground,
      gap: 6,
    },
    loadMore: {
      alignSelf: "flex-start",
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: colors.pillBackground,
    },
    loadMoreText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.pillText,
    },
  });
