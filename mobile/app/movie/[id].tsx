import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import type { MovieLoggedIn } from "shared";
import { MoviesService } from "shared";
import { useFetchMovieShowtimes } from "shared/hooks/useFetchMovieShowtimes";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import { ThemedText } from "@/components/themed-text";
import ShowtimeRow from "@/components/showtimes/ShowtimeRow";
import FilterPills from "@/components/filters/FilterPills";
import CinemaFilterModal from "@/components/filters/CinemaFilterModal";
import DayFilterModal from "@/components/filters/DayFilterModal";
import { useThemeColors } from "@/hooks/use-theme-color";

const SHOWTIMES_PAGE_SIZE = 20;
const BASE_FILTERS = [
  { id: "1", label: "All Showtimes" },
  { id: "cinemas", label: "Cinemas" },
  { id: "days", label: "Days" },
  { id: "you-going", label: "You Going" },
  { id: "you-interested", label: "You Interested" },
  { id: "friends-going", label: "Friends Going" },
  { id: "friends-interested", label: "Friends Interested" },
];

export default function MoviePage() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [selectedFilter, setSelectedFilter] = useState("1");
  const [cinemaModalVisible, setCinemaModalVisible] = useState(false);
  const [dayModalVisible, setDayModalVisible] = useState(false);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);

  const movieId = useMemo(() => Number(id), [id]);
  const snapshotTime = useMemo(
    () => DateTime.now().setZone("Europe/Amsterdam").toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    []
  );
  const { selections: sessionCinemaIds } = useSessionCinemaSelections();
  const showtimesFilters = useMemo(
    () => ({
      selectedCinemaIds: sessionCinemaIds,
      days: selectedDays.length > 0 ? selectedDays : undefined,
    }),
    [sessionCinemaIds, selectedDays]
  );

  const { data: movie, isLoading: isMovieLoading, isError: isMovieError } = useQuery<MovieLoggedIn, Error>({
    queryKey: ["movie", movieId, sessionCinemaIds ?? null],
    queryFn: () =>
      MoviesService.readMovie({
        id: movieId,
        snapshotTime,
        showtimeLimit: 0,
        selectedCinemaIds: sessionCinemaIds,
      }),
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
    filters: showtimesFilters,
  });

  const showtimes = useMemo(() => showtimesData?.pages.flat() ?? [], [showtimesData]);
  const filteredShowtimes = useMemo(() => {
    switch (selectedFilter) {
      case "you-going":
        return showtimes.filter((showtime) => showtime.going === "GOING");
      case "you-interested":
        return showtimes.filter((showtime) => showtime.going === "INTERESTED");
      case "friends-going":
        return showtimes.filter((showtime) => (showtime.friends_going ?? []).length > 0);
      case "friends-interested":
        return showtimes.filter((showtime) => (showtime.friends_interested ?? []).length > 0);
      default:
        return showtimes;
    }
  }, [showtimes, selectedFilter]);
  const handleEndReached = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  const handleSelectFilter = (filterId: string) => {
    if (filterId === "cinemas") {
      setCinemaModalVisible(true);
      return;
    }
    if (filterId === "days") {
      setDayModalVisible(true);
      return;
    }
    setSelectedFilter(filterId);
  };

  const pillFilters = useMemo(() => {
    if (selectedDays.length === 0) return BASE_FILTERS;
    return BASE_FILTERS.map((filter) =>
      filter.id === "days"
        ? { ...filter, label: `Days (${selectedDays.length})` }
        : filter
    );
  }, [selectedDays.length]);

  const activeFilterIds = useMemo(() => {
    const active: string[] = [];
    if (selectedDays.length > 0) {
      active.push("days");
    }
    if (sessionCinemaIds !== undefined) {
      active.push("cinemas");
    }
    return active;
  }, [selectedDays.length, sessionCinemaIds]);

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
        <>
          <FlatList
            data={filteredShowtimes}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.showtimeCardGlow,
                  item.going === "GOING"
                    ? styles.showtimeCardGlowGoing
                    : item.going === "INTERESTED"
                      ? styles.showtimeCardGlowInterested
                      : undefined,
                ]}
              >
                <View
                  style={[
                    styles.showtimeCard,
                    item.going === "GOING"
                      ? styles.showtimeCardGoing
                      : item.going === "INTERESTED"
                        ? styles.showtimeCardInterested
                        : undefined,
                  ]}
                >
                  <ShowtimeRow showtime={item} showFriends />
                </View>
              </View>
            )}
            contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) }]}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            ListHeaderComponent={
              <View style={styles.headerSection}>
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
                <View style={styles.filterPillsWrapper}>
                  <FilterPills
                    filters={pillFilters}
                    selectedId={selectedFilter}
                    onSelect={handleSelectFilter}
                    activeIds={activeFilterIds}
                  />
                </View>
              </View>
            }
            ListEmptyComponent={
              isShowtimesLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={colors.tint} />
                </View>
              ) : isShowtimesError ? (
                <ThemedText style={styles.errorText}>Could not load showtimes.</ThemedText>
              ) : (
                <ThemedText style={styles.noShowtimes}>No upcoming showtimes</ThemedText>
              )
            }
            ListFooterComponent={
              isFetchingNextPage ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={colors.tint} />
                </View>
              ) : null
            }
          />
          <CinemaFilterModal
            visible={cinemaModalVisible}
            onClose={() => setCinemaModalVisible(false)}
          />
          <DayFilterModal
            visible={dayModalVisible}
            onClose={() => setDayModalVisible(false)}
            selectedDays={selectedDays}
            onChange={setSelectedDays}
          />
        </>
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
    headerSection: {
      gap: 16,
    },
    filterPillsWrapper: {
      marginHorizontal: -16,
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
    showtimeCardGlow: {
      borderRadius: 10,
      backgroundColor: colors.cardBackground,
    },
    showtimeCardGlowGoing: {
      shadowColor: colors.green.secondary,
      shadowOpacity: 0.6,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    showtimeCardGlowInterested: {
      shadowColor: colors.orange.secondary,
      shadowOpacity: 0.6,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    showtimeCardGoing: {
      borderColor: colors.green.secondary,
      backgroundColor: colors.green.primary,
    },
    showtimeCardInterested: {
      borderColor: colors.orange.secondary,
      backgroundColor: colors.orange.primary,
    },
    showtimeCard: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 10,
      padding: 10,
      backgroundColor: colors.cardBackground,
      gap: 6,
    },
  });
