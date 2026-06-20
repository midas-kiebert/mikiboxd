/**
 * Expo Router screen/module for (tabs) / index. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { DateTime } from 'luxon';
import { useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useFetchMainPageShowtimes } from 'shared/hooks/useFetchMainPageShowtimes';
import { useFetchMovies, type MovieFilters } from 'shared/hooks/useFetchMovies';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import useAuth from 'shared/hooks/useAuth';
import TopSafeAreaView from '@/components/layout/TopSafeAreaView';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import FiltersRow from '@/components/filters/FiltersRow';
import { useFiltersModal } from '@/components/filters/FiltersModalProvider';
import ActiveFilterChips from '@/components/filters/ActiveFilterChips';
import { ShowtimesListContent, ListEndFooter } from '@/components/showtimes/ShowtimesScreen';
import MovieCard from '@/components/movies/MovieCard';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import { getRuntimeBoundsFromSelections } from '@/components/filters/runtime-range-utils';
import { applyDisplayPreset, type DisplayPreset } from '@/components/filters/saved-presets';
import {
  SHARED_TAB_FILTER_PRESET_SCOPE,
  getSelectedStatusesFromShowtimeFilter,
} from '@/components/filters/shared-tab-filters';
import { useThemeColors } from '@/hooks/use-theme-color';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from '@/utils/reset-infinite-query';

export default function MainShowtimesScreen() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [isFilterTransitionLoading, setIsFilterTransitionLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { openFiltersModal } = useFiltersModal();
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();

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
    sessionCinemaIds,
    setSessionCinemaIds,
    selectedDays,
    setSelectedDays,
    selectedTimeRanges,
    setSelectedTimeRanges,
    selectedRuntimeRanges,
    setSelectedRuntimeRanges,
    selectedListIds,
  } = useSharedTabFilters();

  const { user } = useAuth();
  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());
  const effectiveWatchlistOnly = hasLetterboxdUsername ? watchlistOnly : false;
  const effectiveAppliedWatchlistOnly = hasLetterboxdUsername ? appliedWatchlistOnly : false;
  const effectiveHideWatched = hasLetterboxdUsername ? hideWatched : false;
  const effectiveAppliedHideWatched = hasLetterboxdUsername ? appliedHideWatched : false;

  const { data: preferredCinemaIds } = useFetchSelectedCinemas();

  const dayAnchorKey =
    DateTime.now().setZone('Europe/Amsterdam').startOf('day').toISODate() ?? '';
  const resolvedApiDays = useMemo(
    () => resolveDaySelectionsForApi(selectedDays),
    [dayAnchorKey, selectedDays]
  );
  const runtimeBounds = useMemo(
    () => getRuntimeBoundsFromSelections(selectedRuntimeRanges),
    [selectedRuntimeRanges]
  );

  useEffect(() => {
    if (hasLetterboxdUsername || !watchlistOnly) return;
    setWatchlistOnly(false);
  }, [hasLetterboxdUsername, setWatchlistOnly, watchlistOnly]);

  useEffect(() => {
    if (hasLetterboxdUsername || !hideWatched) return;
    setHideWatched(false);
  }, [hasLetterboxdUsername, setHideWatched, hideWatched]);

  // ─── Showtimes query ────────────────────────────────────────────────────────
  const showtimesFilters = useMemo(() => ({
    query: searchQuery || undefined,
    selectedCinemaIds: sessionCinemaIds,
    days: resolvedApiDays,
    timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
    runtimeMin: runtimeBounds.runtimeMin,
    runtimeMax: runtimeBounds.runtimeMax,
    selectedStatuses: getSelectedStatusesFromShowtimeFilter(appliedShowtimeFilter),
    watchlistOnly: effectiveAppliedWatchlistOnly ? true : undefined,
    hideWatched: effectiveAppliedHideWatched ? true : undefined,
    selectedListIds: selectedListIds.length > 0 ? selectedListIds : undefined,
  }), [
    searchQuery, appliedShowtimeFilter, resolvedApiDays, selectedTimeRanges,
    runtimeBounds.runtimeMin, runtimeBounds.runtimeMax, sessionCinemaIds, effectiveAppliedWatchlistOnly,
    effectiveAppliedHideWatched, selectedListIds,
  ]);

  const activeShowtimesQuery = useFetchMainPageShowtimes({
    limit: 20,
    snapshotTime,
    filters: showtimesFilters,
    enabled: isFocused && !groupByMovie,
  });

  // ─── Movies query (Group by Movie mode) ─────────────────────────────────────
  const movieFilters = useMemo<MovieFilters>(
    () => ({
      query: searchQuery,
      watchlistOnly: effectiveAppliedWatchlistOnly ? true : undefined,
      hideWatched: effectiveAppliedHideWatched ? true : undefined,
      days: resolvedApiDays,
      timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
      runtimeMin: runtimeBounds.runtimeMin,
      runtimeMax: runtimeBounds.runtimeMax,
      selectedCinemaIds: sessionCinemaIds,
      selectedStatuses: getSelectedStatusesFromShowtimeFilter(appliedShowtimeFilter),
      selectedListIds: selectedListIds.length > 0 ? selectedListIds : undefined,
    }),
    [
      searchQuery, effectiveAppliedWatchlistOnly, effectiveAppliedHideWatched, resolvedApiDays, selectedTimeRanges,
      runtimeBounds.runtimeMin, runtimeBounds.runtimeMax, sessionCinemaIds, appliedShowtimeFilter, selectedListIds,
    ]
  );
  const moviesQuery = useFetchMovies({
    limit: 20,
    snapshotTime,
    filters: movieFilters,
    enabled: isFocused && groupByMovie,
  });

  // ─── Active query ────────────────────────────────────────────────────────────
  const {
    data: showtimesData,
    isLoading: showtimesLoading,
    isFetchingNextPage: showtimesFetchingNextPage,
    isFetching: showtimesFetching,
    hasNextPage: showtimesHasNextPage,
    fetchNextPage: showtimesFetchNextPage,
  } = activeShowtimesQuery;

  const {
    data: moviesData,
    isLoading: moviesLoading,
    isFetchingNextPage: moviesFetchingNextPage,
    isFetching: moviesFetching,
    hasNextPage: moviesHasNextPage,
    fetchNextPage: moviesFetchNextPage,
  } = moviesQuery;

  const isAppliedFilterTransitionPending =
    selectedShowtimeFilter !== appliedShowtimeFilter ||
    effectiveWatchlistOnly !== effectiveAppliedWatchlistOnly ||
    effectiveHideWatched !== effectiveAppliedHideWatched;

  const showtimes = useMemo(() => showtimesData?.pages.flat() ?? [], [showtimesData]);
  const movies = useMemo(() => moviesData?.pages.flat() ?? [], [moviesData]);
  const visibleShowtimes = isFilterTransitionLoading ? [] : showtimes;

  useEffect(() => {
    if (!isFilterTransitionLoading) return;
    if (isAppliedFilterTransitionPending) return;
    const frame = requestAnimationFrame(() => setIsFilterTransitionLoading(false));
    return () => cancelAnimationFrame(frame);
  }, [isAppliedFilterTransitionPending, isFilterTransitionLoading]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (groupByMovie) {
        await refreshInfiniteQueryWithFreshSnapshot({
          queryClient,
          queryKey: ['movies', movieFilters],
          setSnapshotTime,
        });
      } else {
        await refreshInfiniteQueryWithFreshSnapshot({
          queryClient,
          queryKey: ['showtimes', 'main', showtimesFilters],
          setSnapshotTime,
        });
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleApplyPreset = (preset: DisplayPreset) => {
    setIsFilterTransitionLoading(true);
    applyDisplayPreset(preset, {
      hasLetterboxdUsername,
      setSelectedShowtimeFilter,
      setWatchlistOnly,
      setHideWatched,
      setSelectedDays,
      setSelectedTimeRanges,
      setSelectedRuntimeRanges,
      setGroupByMovie,
      setSessionCinemaIds,
    });
  };

  const filtersRowProps = {
    scope: SHARED_TAB_FILTER_PRESET_SCOPE,
    onOpenModal: () => openFiltersModal({ showGroupByMovie: true, showPresets: true }),
    onApplyPreset: handleApplyPreset,
  };

  const activeChipsProps = {
    groupByMovie,
    setGroupByMovie,
    watchlistOnly: effectiveWatchlistOnly,
    setWatchlistOnly: (v: boolean) => { setIsFilterTransitionLoading(true); setWatchlistOnly(v); },
    hideWatched: effectiveHideWatched,
    setHideWatched: (v: boolean) => { setIsFilterTransitionLoading(true); setHideWatched(v); },
    canUseWatchlistFilter: hasLetterboxdUsername,
    selectedShowtimeFilter,
    setSelectedShowtimeFilter: (v: typeof selectedShowtimeFilter) => {
      setIsFilterTransitionLoading(true);
      setSelectedShowtimeFilter(v);
    },
    showStatusFilter: true,
    selectedDays,
    setSelectedDays,
    selectedTimeRanges,
    setSelectedTimeRanges,
    selectedRuntimeRanges,
    setSelectedRuntimeRanges,
    onOpenFilters: () => openFiltersModal({ showGroupByMovie: true, showPresets: true }),
    onClearAll: () => {
      setIsFilterTransitionLoading(true);
      setSelectedShowtimeFilter('all');
      setWatchlistOnly(false);
      setHideWatched(false);
      setGroupByMovie(false);
      setSelectedDays([]);
      setSelectedTimeRanges([]);
      setSelectedRuntimeRanges([]);
      if (preferredCinemaIds) setSessionCinemaIds(preferredCinemaIds);
    },
  };

  const renderMoviesEmpty = () => {
    if (moviesLoading || moviesFetching) {
      return (
        <ThemedView style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </ThemedView>
      );
    }
    return (
      <ThemedView style={styles.centerContainer}>
        <ThemedText style={styles.emptyText}>No movies found</ThemedText>
      </ThemedView>
    );
  };

  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar />
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder={groupByMovie ? 'Search movies' : 'Search showtimes'}
      />
      <FiltersRow {...filtersRowProps} />
      <ActiveFilterChips {...activeChipsProps} />
      {groupByMovie ? (
        <FlatList
          data={movies}
          renderItem={({ item }) => (
            <MovieCard movie={item} onPress={(movie) => router.push(`/movie/${movie.id}`)} />
          )}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.movieFeed}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderMoviesEmpty}
          ListFooterComponent={
            moviesFetchingNextPage ? (
              <ThemedView style={styles.footerLoader}>
                <ActivityIndicator size="large" color={colors.tint} />
              </ThemedView>
            ) : !moviesHasNextPage && !moviesLoading && !moviesFetching && movies.length > 0 ? (
              <ListEndFooter label="No more movies" />
            ) : null
          }
          onEndReached={() => {
            if (moviesHasNextPage && !moviesFetchingNextPage) moviesFetchNextPage();
          }}
          onEndReachedThreshold={2}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        />
      ) : (
        <ShowtimesListContent
          showtimes={visibleShowtimes}
          isLoading={showtimesLoading || isFilterTransitionLoading}
          isFetching={showtimesFetching || isFilterTransitionLoading}
          isFetchingNextPage={showtimesFetchingNextPage}
          hasNextPage={showtimesHasNextPage}
          onLoadMore={() => {
            if (showtimesHasNextPage && !showtimesFetchingNextPage) showtimesFetchNextPage();
          }}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          emptyText="No showtimes found"
        />
      )}
    </TopSafeAreaView>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    movieFeed: { padding: 16 },
    footerLoader: { paddingVertical: 20, alignItems: 'center' },
    centerContainer: { paddingVertical: 40, alignItems: 'center' },
    emptyText: { fontSize: 16, color: colors.textSecondary },
  });
