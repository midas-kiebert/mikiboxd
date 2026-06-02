/**
 * Expo Router screen/module for (tabs) / movies. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { MeService } from 'shared';
import { useFetchMovies, type MovieFilters } from 'shared/hooks/useFetchMovies';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import useAuth from 'shared/hooks/useAuth';
import { DateTime } from 'luxon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import FiltersRow from '@/components/filters/FiltersRow';
import { useFiltersModal } from '@/components/filters/FiltersModalProvider';
import ActiveFilterChips from '@/components/filters/ActiveFilterChips';
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
import MovieCard from '@/components/movies/MovieCard';
import { isCinemaSelectionDifferentFromPreferred } from '@/utils/cinema-selection';
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from '@/utils/reset-infinite-query';

export default function MovieScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const { openFiltersModal } = useFiltersModal();
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();

  const {
    selectedShowtimeFilter,
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
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());
  const { data: preferredCinemaIds } = useFetchSelectedCinemas();
  const { data: cinemaPresets = [] } = useQuery({
    queryKey: ['cinema-presets'],
    queryFn: () => MeService.getCinemaPresets(),
  });

  useEffect(() => {
    if (hasLetterboxdUsername || !watchlistOnly) return;
    setWatchlistOnly(false);
  }, [hasLetterboxdUsername, setWatchlistOnly, watchlistOnly]);

  const movieFilters = useMemo<MovieFilters>(
    () => ({
      query: searchQuery,
      watchlistOnly: effectiveAppliedWatchlistOnly ? true : undefined,
      days: resolvedApiDays,
      timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
      runtimeMin: runtimeBounds.runtimeMin,
      runtimeMax: runtimeBounds.runtimeMax,
      selectedCinemaIds: sessionCinemaIds,
      selectedStatuses: getSelectedStatusesFromShowtimeFilter(selectedShowtimeFilter),
    }),
    [
      searchQuery,
      effectiveAppliedWatchlistOnly,
      resolvedApiDays,
      selectedTimeRanges,
      runtimeBounds.runtimeMin,
      runtimeBounds.runtimeMax,
      sessionCinemaIds,
      selectedShowtimeFilter,
    ]
  );

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
      effectiveWatchlistOnly,
      selectedDays,
      selectedTimeRanges,
      selectedRuntimeRanges,
    ]
  );

  const { data: moviesData, isLoading, isFetchingNextPage, isFetching, hasNextPage, fetchNextPage } =
    useFetchMovies({ limit: 15, snapshotTime, filters: movieFilters, enabled: isFocused });

  const movies = moviesData?.pages.flat() || [];

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshInfiniteQueryWithFreshSnapshot({
        queryClient,
        queryKey: ['movies', movieFilters],
        setSnapshotTime,
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  };

  const renderFooter = () =>
    isFetchingNextPage ? (
      <ThemedView style={styles.footerLoader}>
        <ActivityIndicator size="large" color={colors.tint} />
      </ThemedView>
    ) : null;

  const renderEmpty = () => {
    if (isLoading || isFetching) {
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

  // Cinema chip label for ActiveFilterChips
  const cinemaChipLabel = useMemo(() => {
    if (!isCinemaFilterActive) return null;
    const ids = sessionCinemaIds ?? preferredCinemaIds ?? [];
    const sig = JSON.stringify(Array.from(new Set(ids)).sort((a, b) => a - b));
    const preset = cinemaPresets.find(
      (p) => JSON.stringify(Array.from(new Set(p.cinema_ids)).sort((a, b) => a - b)) === sig
    );
    return preset?.name ?? `${ids.length} cinemas`;
  }, [isCinemaFilterActive, sessionCinemaIds, preferredCinemaIds, cinemaPresets]);

  const handleApplyPreset = (preset: PageFilterPresetState) => {
    if (preset.selected_showtime_filter !== undefined) {
      setSelectedShowtimeFilter(toSharedTabShowtimeFilter(preset.selected_showtime_filter));
    }
    setWatchlistOnly(hasLetterboxdUsername && Boolean(preset.watchlist_only));
    setSelectedDays(preset.days ?? []);
    setSelectedTimeRanges(preset.time_ranges ?? []);
    setSelectedRuntimeRanges(preset.runtime_ranges ?? []);
  };


  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar />
      <SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder="Search movies" />
      <FiltersRow
        scope={SHARED_TAB_FILTER_PRESET_SCOPE}
        activeFilterCount={activeFilterCount}
        currentPresetFilters={currentPresetFilters}
        groupByMovie={groupByMovie}
        isModalOpen={false}
        onOpenModal={() => openFiltersModal({ showGroupByMovie: false })}
        onApplyPreset={handleApplyPreset}
      />
      <ActiveFilterChips
        groupByMovie={groupByMovie}
        setGroupByMovie={setGroupByMovie}
        watchlistOnly={effectiveWatchlistOnly}
        setWatchlistOnly={setWatchlistOnly}
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
        cinemaChipLabel={cinemaChipLabel}
        onClearCinemas={
          isCinemaFilterActive && preferredCinemaIds
            ? () => setSessionCinemaIds(preferredCinemaIds)
            : undefined
        }
        onClearAll={() => {
          setSelectedShowtimeFilter(toSharedTabShowtimeFilter('all'));
          setWatchlistOnly(false);
          setSelectedDays([]);
          setSelectedTimeRanges([]);
          setSelectedRuntimeRanges([]);
          if (preferredCinemaIds) setSessionCinemaIds(preferredCinemaIds);
        }}
      />

      <FlatList
        data={movies}
        renderItem={({ item }) => (
          <MovieCard movie={item} onPress={(movie) => router.push(`/movie/${movie.id}`)} />
        )}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.movieFeed}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={2}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      />
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
