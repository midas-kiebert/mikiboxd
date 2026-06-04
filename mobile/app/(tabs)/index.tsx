/**
 * Expo Router screen/module for (tabs) / index. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { DateTime } from 'luxon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { MeService } from 'shared';
import { useFetchMainPageShowtimes } from 'shared/hooks/useFetchMainPageShowtimes';
import { useFetchMovies, type MovieFilters } from 'shared/hooks/useFetchMovies';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import useAuth from 'shared/hooks/useAuth';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import FiltersRow from '@/components/filters/FiltersRow';
import { useFiltersModal } from '@/components/filters/FiltersModalProvider';
import ActiveFilterChips from '@/components/filters/ActiveFilterChips';
import { ShowtimesListContent } from '@/components/showtimes/ShowtimesScreen';
import MovieCard from '@/components/movies/MovieCard';
import { type PageFilterPresetState } from '@/components/filters/FilterPresetsModal';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import { getRuntimeBoundsFromSelections } from '@/components/filters/runtime-range-utils';
import {
  SHARED_TAB_FILTER_PRESET_SCOPE,
  getSelectedStatusesFromShowtimeFilter,
  toSharedTabShowtimeFilter,
} from '@/components/filters/shared-tab-filters';
import { useThemeColors } from '@/hooks/use-theme-color';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';
import { isCinemaSelectionDifferentFromPreferred } from '@/utils/cinema-selection';
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
  } = useSharedTabFilters();

  const { user } = useAuth();
  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());
  const effectiveWatchlistOnly = hasLetterboxdUsername ? watchlistOnly : false;
  const effectiveAppliedWatchlistOnly = hasLetterboxdUsername ? appliedWatchlistOnly : false;

  const { data: preferredCinemaIds } = useFetchSelectedCinemas();
  const { data: cinemaPresets = [] } = useQuery({
    queryKey: ['cinema-presets'],
    queryFn: () => MeService.getCinemaPresets(),
  });

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
  }), [
    searchQuery, appliedShowtimeFilter, resolvedApiDays, selectedTimeRanges,
    runtimeBounds.runtimeMin, runtimeBounds.runtimeMax, sessionCinemaIds, effectiveAppliedWatchlistOnly,
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
      days: resolvedApiDays,
      timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
      runtimeMin: runtimeBounds.runtimeMin,
      runtimeMax: runtimeBounds.runtimeMax,
      selectedCinemaIds: sessionCinemaIds,
      selectedStatuses: getSelectedStatusesFromShowtimeFilter(appliedShowtimeFilter),
    }),
    [
      searchQuery, effectiveAppliedWatchlistOnly, resolvedApiDays, selectedTimeRanges,
      runtimeBounds.runtimeMin, runtimeBounds.runtimeMax, sessionCinemaIds, appliedShowtimeFilter,
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
    effectiveWatchlistOnly !== effectiveAppliedWatchlistOnly;

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

  // ─── Filter pills helpers ────────────────────────────────────────────────────
  const isCinemaFilterActive = useMemo(
    () => isCinemaSelectionDifferentFromPreferred({ sessionCinemaIds, preferredCinemaIds }),
    [sessionCinemaIds, preferredCinemaIds]
  );

  const activeFilterCount = [
    selectedShowtimeFilter !== 'all',
    effectiveWatchlistOnly,
    groupByMovie,
    selectedDays.length > 0,
    selectedTimeRanges.length > 0,
    selectedRuntimeRanges.length > 0,
    isCinemaFilterActive,
  ].filter(Boolean).length;

  const cinemaChipLabel = useMemo(() => {
    if (!isCinemaFilterActive) return null;
    const ids = sessionCinemaIds ?? preferredCinemaIds ?? [];
    const sig = JSON.stringify(Array.from(new Set(ids)).sort((a, b) => a - b));
    const preset = cinemaPresets.find(
      (p) => JSON.stringify(Array.from(new Set(p.cinema_ids)).sort((a, b) => a - b)) === sig
    );
    return preset?.name ?? `${ids.length} cinemas`;
  }, [isCinemaFilterActive, sessionCinemaIds, preferredCinemaIds, cinemaPresets]);

  const currentPresetFilters = useMemo<PageFilterPresetState>(
    () => ({
      selected_showtime_filter: selectedShowtimeFilter,
      showtime_audience: 'including-friends',
      watchlist_only: effectiveWatchlistOnly,
      days: selectedDays.length > 0 ? selectedDays : null,
      time_ranges: selectedTimeRanges.length > 0 ? selectedTimeRanges : null,
      runtime_ranges: selectedRuntimeRanges.length > 0 ? selectedRuntimeRanges : null,
    }),
    [
      selectedShowtimeFilter,
      effectiveWatchlistOnly, selectedDays, selectedTimeRanges, selectedRuntimeRanges,
    ]
  );

  const handleApplyPreset = (preset: PageFilterPresetState) => {
    setIsFilterTransitionLoading(true);
    setSelectedShowtimeFilter(toSharedTabShowtimeFilter(preset.selected_showtime_filter));
    setWatchlistOnly(hasLetterboxdUsername && Boolean(preset.watchlist_only));
    setSelectedDays(preset.days ?? []);
    setSelectedTimeRanges(preset.time_ranges ?? []);
    setSelectedRuntimeRanges(preset.runtime_ranges ?? []);
  };

  const filtersRowProps = {
    scope: SHARED_TAB_FILTER_PRESET_SCOPE,
    activeFilterCount,
    currentPresetFilters,
    groupByMovie,
    isModalOpen: false,
    onOpenModal: () => openFiltersModal({ showGroupByMovie: true }),
    onApplyPreset: handleApplyPreset,
  };

  const activeChipsProps = {
    groupByMovie,
    setGroupByMovie,
    watchlistOnly: effectiveWatchlistOnly,
    setWatchlistOnly: (v: boolean) => { setIsFilterTransitionLoading(true); setWatchlistOnly(v); },
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
    cinemaChipLabel,
    onClearCinemas:
      isCinemaFilterActive && preferredCinemaIds
        ? () => setSessionCinemaIds(preferredCinemaIds)
        : undefined,
    onClearAll: () => {
      setIsFilterTransitionLoading(true);
      setSelectedShowtimeFilter('all');
      setWatchlistOnly(false);
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
    <SafeAreaView style={styles.container} edges={['top']}>
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
    </SafeAreaView>
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
