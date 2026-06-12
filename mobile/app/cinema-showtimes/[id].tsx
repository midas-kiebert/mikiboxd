/**
 * Expo Router screen/module for cinema-showtimes / [id]. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { DateTime } from "luxon";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import { useFetchMainPageShowtimes } from "shared/hooks/useFetchMainPageShowtimes";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchMovies } from "shared/hooks/useFetchMovies";
import useAuth from "shared/hooks/useAuth";

import ShowtimesScreen, { ShowtimesScreenSkeleton } from "@/components/showtimes/ShowtimesScreen";
import { useDeferredMount } from "@/utils/use-deferred-mount";
import FiltersButtonRow from "@/components/filters/FiltersButtonRow";
import FiltersModal from "@/components/filters/FiltersModal";
import ActiveFilterChips from "@/components/filters/ActiveFilterChips";
import MovieCard from "@/components/movies/MovieCard";
import { ThemedText } from "@/components/themed-text";
import { resolveDaySelectionsForApi } from "@/components/filters/day-filter-utils";
import { getRuntimeBoundsFromSelections } from "@/components/filters/runtime-range-utils";
import {
  getSelectedStatusesFromShowtimeFilter,
} from "@/components/filters/shared-tab-filters";
import { useThemeColors } from "@/hooks/use-theme-color";
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from "@/utils/reset-infinite-query";
import { useSharedTabFilters } from "@/hooks/useSharedTabFilters";

const EMPTY_DAYS: string[] = [];
const EMPTY_TIME_RANGES: string[] = [];
const EMPTY_RUNTIME_RANGES: string[] = [];

const getRouteParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function CinemaShowtimesScreen() {
  const { name, city } = useLocalSearchParams<{
    name?: string | string[];
    city?: string | string[];
  }>();
  const cinemaKey = `cinema:${Array.isArray(name) ? name[0] : name}:${Array.isArray(city) ? city[0] : city}`;
  const ready = useDeferredMount(cinemaKey);
  if (!ready) {
    const routeCinemaName = getRouteParam(name)?.trim() ?? "";
    const routeCityName = getRouteParam(city)?.trim() ?? "";
    return (
      <ShowtimesScreenSkeleton
        topBarTitle={routeCinemaName || "Cinema"}
        topBarTitleSuffix={routeCityName ? `(${routeCityName})` : undefined}
        topBarShowBackButton
      />
    );
  }
  return <CinemaShowtimesContent />;
}

function CinemaShowtimesContent() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const { id, name, city } = useLocalSearchParams<{
    id?: string | string[];
    name?: string | string[];
    city?: string | string[];
  }>();
  const routeCinemaId = useMemo(() => Number(getRouteParam(id)), [id]);
  const cinemaId = Number.isFinite(routeCinemaId) && routeCinemaId > 0 ? routeCinemaId : -1;
  const routeCinemaName = useMemo(() => getRouteParam(name)?.trim() ?? "", [name]);
  const routeCityName = useMemo(() => getRouteParam(city)?.trim() ?? "", [city]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersModalVisible, setFiltersModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());

  const {
    selectedShowtimeFilter,
    appliedShowtimeFilter,
    setSelectedShowtimeFilter,
    watchlistOnly,
    appliedWatchlistOnly,
    setWatchlistOnly,
    hideWatched,
    appliedHideWatched,
    setHideWatched,
    groupByMovie,
    setGroupByMovie,
    selectedDays: sharedSelectedDays,
    setSelectedDays,
    selectedTimeRanges: sharedSelectedTimeRanges,
    setSelectedTimeRanges,
    selectedRuntimeRanges: sharedSelectedRuntimeRanges,
    setSelectedRuntimeRanges,
  } = useSharedTabFilters();
  const { user } = useAuth();
  const isFocused = useIsFocused();
  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());
  const effectiveWatchlistOnly = hasLetterboxdUsername ? watchlistOnly : false;
  const effectiveAppliedWatchlistOnly = hasLetterboxdUsername ? appliedWatchlistOnly : false;
  const effectiveHideWatched = hasLetterboxdUsername ? hideWatched : false;
  const effectiveAppliedHideWatched = hasLetterboxdUsername ? appliedHideWatched : false;
  const selectedDays = sharedSelectedDays ?? EMPTY_DAYS;
  const selectedTimeRanges = sharedSelectedTimeRanges ?? EMPTY_TIME_RANGES;
  const selectedRuntimeRanges = sharedSelectedRuntimeRanges ?? EMPTY_RUNTIME_RANGES;
  const dayAnchorKey =
    DateTime.now().setZone("Europe/Amsterdam").startOf("day").toISODate() ?? "";
  const resolvedApiDays = useMemo(
    () => resolveDaySelectionsForApi(selectedDays),
    [dayAnchorKey, selectedDays]
  );
  const runtimeBounds = useMemo(
    () => getRuntimeBoundsFromSelections(selectedRuntimeRanges),
    [selectedRuntimeRanges]
  );
  const { data: cinemas } = useFetchCinemas();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (hasLetterboxdUsername || !watchlistOnly) return;
    setWatchlistOnly(false);
  }, [hasLetterboxdUsername, setWatchlistOnly, watchlistOnly]);

  useEffect(() => {
    if (hasLetterboxdUsername || !hideWatched) return;
    setHideWatched(false);
  }, [hasLetterboxdUsername, setHideWatched, hideWatched]);

  const cinemaFromList = useMemo(
    () => cinemas?.find((cinemaValue) => cinemaValue.id === cinemaId),
    [cinemaId, cinemas]
  );
  const cinemaName = routeCinemaName || cinemaFromList?.name || "Cinema";
  const cityName = routeCityName || cinemaFromList?.city.name || "";
  const topBarTitleSuffix = cityName ? `(${cityName})` : undefined;

  // ─── Showtimes query ─────────────────────────────────────────────────────────
  const showtimesFilters = useMemo(() => ({
    query: searchQuery || undefined,
    selectedCinemaIds: [cinemaId],
    days: resolvedApiDays,
    timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
    runtimeMin: runtimeBounds.runtimeMin,
    runtimeMax: runtimeBounds.runtimeMax,
    selectedStatuses: getSelectedStatusesFromShowtimeFilter(appliedShowtimeFilter),
    watchlistOnly: effectiveAppliedWatchlistOnly ? true : undefined,
    hideWatched: effectiveAppliedHideWatched ? true : undefined,
  }), [
    cinemaId,
    searchQuery,
    resolvedApiDays,
    appliedShowtimeFilter,
    selectedTimeRanges,
    runtimeBounds.runtimeMin,
    runtimeBounds.runtimeMax,
    effectiveAppliedWatchlistOnly,
    effectiveAppliedHideWatched,
  ]);

  const {
    data: showtimesData,
    isLoading: showtimesLoading,
    isFetchingNextPage: showtimesFetchingNextPage,
    isFetching: showtimesFetching,
    hasNextPage: showtimesHasNextPage,
    fetchNextPage: showtimesFetchNextPage,
  } = useFetchMainPageShowtimes({
    limit: 20,
    snapshotTime,
    filters: showtimesFilters,
    enabled: isFocused && !groupByMovie,
  });

  const showtimes = useMemo(() => showtimesData?.pages.flat() ?? [], [showtimesData]);

  // ─── Movies query (Group by Movie mode) ──────────────────────────────────────
  const moviesFilters = useMemo(() => ({
    query: searchQuery || undefined,
    selectedCinemaIds: [cinemaId],
    days: resolvedApiDays,
    timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
    runtimeMin: runtimeBounds.runtimeMin,
    runtimeMax: runtimeBounds.runtimeMax,
    selectedStatuses: getSelectedStatusesFromShowtimeFilter(appliedShowtimeFilter),
    watchlistOnly: effectiveAppliedWatchlistOnly ? true : undefined,
    hideWatched: effectiveAppliedHideWatched ? true : undefined,
  }), [
    cinemaId,
    searchQuery,
    resolvedApiDays,
    appliedShowtimeFilter,
    selectedTimeRanges,
    runtimeBounds.runtimeMin,
    runtimeBounds.runtimeMax,
    effectiveAppliedWatchlistOnly,
    effectiveAppliedHideWatched,
  ]);

  const {
    data: moviesData,
    isLoading: moviesLoading,
    isFetchingNextPage: moviesFetchingNextPage,
    isFetching: moviesFetching,
    hasNextPage: moviesHasNextPage,
    fetchNextPage: moviesFetchNextPage,
  } = useFetchMovies({
    limit: 20,
    snapshotTime,
    filters: moviesFilters,
    enabled: isFocused && groupByMovie,
  });

  const movies = useMemo(() => moviesData?.pages.flat() ?? [], [moviesData]);

  // ─── Handlers ────────────────────────────────────────────────────────────────
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (groupByMovie) {
        await refreshInfiniteQueryWithFreshSnapshot({
          queryClient,
          queryKey: ["movies", moviesFilters],
          setSnapshotTime,
        });
      } else {
        await refreshInfiniteQueryWithFreshSnapshot({
          queryClient,
          queryKey: ["showtimes", "main", showtimesFilters],
          setSnapshotTime,
        });
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleLoadMore = () => {
    if (showtimesHasNextPage && !showtimesFetchingNextPage) {
      showtimesFetchNextPage();
    }
  };

  const handleClearAll = () => {
    setSelectedShowtimeFilter("all");
    setWatchlistOnly(false);
    setHideWatched(false);
    setGroupByMovie(false);
    setSelectedDays([]);
    setSelectedTimeRanges([]);
    setSelectedRuntimeRanges([]);
  };

  // ─── Render ───────────────────────────────────────────────────────────────────
  const isLoading = groupByMovie ? moviesLoading : showtimesLoading;
  const isFetching = groupByMovie ? moviesFetching : showtimesFetching;
  const resultCount = groupByMovie ? movies.length : showtimes.length;

  const moviesContent = groupByMovie ? (
    <FlatList
      style={styles.flex}
      data={movies}
      renderItem={({ item }) => (
        <MovieCard movie={item} onPress={(movie) => router.push(`/movie/${movie.id}`)} />
      )}
      keyExtractor={(item) => item.id.toString()}
      contentContainerStyle={styles.movieFeed}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        moviesLoading || moviesFetching ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.tint} />
          </View>
        ) : (
          <View style={styles.centerContainer}>
            <ThemedText style={styles.emptyText}>No movies found</ThemedText>
          </View>
        )
      }
      ListFooterComponent={
        moviesFetchingNextPage ? (
          <View style={styles.footerLoader}>
            <ActivityIndicator size="small" color={colors.tint} />
          </View>
        ) : null
      }
      onEndReached={() => {
        if (moviesHasNextPage && !moviesFetchingNextPage) moviesFetchNextPage();
      }}
      onEndReachedThreshold={2}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    />
  ) : undefined;

  return (
    <>
      <ShowtimesScreen
        topBarTitle={cinemaName}
        topBarTitleSuffix={topBarTitleSuffix}
        topBarShowBackButton
        showtimes={showtimes}
        isLoading={isLoading}
        isFetching={isFetching}
        isFetchingNextPage={showtimesFetchingNextPage}
        hasNextPage={showtimesHasNextPage}
        onLoadMore={handleLoadMore}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filterRow={
          <>
            <FiltersButtonRow onPress={() => setFiltersModalVisible(true)} />
            <ActiveFilterChips
              groupByMovie={groupByMovie}
              setGroupByMovie={setGroupByMovie}
              watchlistOnly={effectiveWatchlistOnly}
              setWatchlistOnly={setWatchlistOnly}
              hideWatched={effectiveHideWatched}
              setHideWatched={setHideWatched}
              canUseWatchlistFilter={hasLetterboxdUsername}
              selectedShowtimeFilter={selectedShowtimeFilter}
              setSelectedShowtimeFilter={setSelectedShowtimeFilter}
              showStatusFilter
              selectedDays={selectedDays}
              setSelectedDays={setSelectedDays}
              selectedTimeRanges={selectedTimeRanges}
              setSelectedTimeRanges={setSelectedTimeRanges}
              selectedRuntimeRanges={selectedRuntimeRanges}
              setSelectedRuntimeRanges={setSelectedRuntimeRanges}
              onClearAll={handleClearAll}
            />
          </>
        }
        listContent={moviesContent}
        emptyText="No showtimes for this cinema"
        openModalOptions={{ openedFrom: { cinemaId } }}
      />
      <FiltersModal
        visible={filtersModalVisible}
        onClose={() => setFiltersModalVisible(false)}
        groupByMovie={groupByMovie}
        setGroupByMovie={setGroupByMovie}
        showGroupByMovie
        watchlistOnly={effectiveWatchlistOnly}
        setWatchlistOnly={setWatchlistOnly}
        hideWatched={effectiveHideWatched}
        setHideWatched={setHideWatched}
        canUseWatchlistFilter={hasLetterboxdUsername}
        selectedShowtimeFilter={selectedShowtimeFilter}
        setSelectedShowtimeFilter={setSelectedShowtimeFilter}
        showStatusFilter
        showCinemas={false}
        selectedDays={selectedDays}
        setSelectedDays={setSelectedDays}
        selectedTimeRanges={selectedTimeRanges}
        setSelectedTimeRanges={setSelectedTimeRanges}
        selectedRuntimeRanges={selectedRuntimeRanges}
        setSelectedRuntimeRanges={setSelectedRuntimeRanges}
        resultCount={resultCount}
      />
    </>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    flex: { flex: 1 },
    movieFeed: { padding: 16 },
    footerLoader: { paddingVertical: 20, alignItems: "center" },
    centerContainer: { paddingVertical: 40, alignItems: "center" },
    emptyText: { fontSize: 16, color: colors.textSecondary },
  });
