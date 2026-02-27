/**
 * Expo Router screen/module for (tabs) / movies. It controls navigation and screen-level state for this route.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useFetchMovies, type MovieFilters } from 'shared/hooks/useFetchMovies';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import { DateTime } from 'luxon';
import { useQueryClient } from '@tanstack/react-query';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import CinemaPresetQuickPopover from '@/components/filters/CinemaPresetQuickPopover';
import FilterPills, {
  type FilterPillLongPressPosition,
} from '@/components/filters/FilterPills';
import CinemaFilterModal from '@/components/filters/CinemaFilterModal';
import DayFilterModal from '@/components/filters/DayFilterModal';
import FilterPresetsModal, {
  type PageFilterPresetState,
} from '@/components/filters/FilterPresetsModal';
import TimeFilterModal from '@/components/filters/TimeFilterModal';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import {
  SHARED_TAB_FILTER_PRESET_SCOPE,
  buildSharedTabActiveFilterIds,
  buildSharedTabPillFilters,
  cycleSharedTabShowtimeFilter,
  getSelectedStatusesFromShowtimeFilter,
  toSharedTabShowtimeFilter,
  type SharedTabFilterId,
  type SharedTabShowtimeFilter,
} from '@/components/filters/shared-tab-filters';
import { useThemeColors } from '@/hooks/use-theme-color';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';
import MovieCard from '@/components/movies/MovieCard';
import { isCinemaSelectionDifferentFromPreferred } from '@/utils/cinema-selection';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';

export default function MovieScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const router = useRouter();
  // Current text typed into the search input.
  const [searchQuery, setSearchQuery] = useState('');
  // Controls pull-to-refresh spinner visibility.
  const [refreshing, setRefreshing] = useState(false);
  // Controls visibility of the cinema-filter modal.
  const [cinemaModalVisible, setCinemaModalVisible] = useState(false);
  const [cinemaPresetPopoverVisible, setCinemaPresetPopoverVisible] = useState(false);
  const [cinemaPresetPopoverAnchor, setCinemaPresetPopoverAnchor] =
    useState<FilterPillLongPressPosition | null>(null);
  // Controls visibility of the day-filter modal.
  const [dayModalVisible, setDayModalVisible] = useState(false);
  // Controls visibility of the time-filter modal.
  const [timeModalVisible, setTimeModalVisible] = useState(false);
  // Controls visibility of the filter-presets modal.
  const [presetModalVisible, setPresetModalVisible] = useState(false);
  const [selectedMovieShowtimeFilter, setSelectedMovieShowtimeFilterState] =
    useState<SharedTabShowtimeFilter>('all');
  const [appliedMovieShowtimeFilter, setAppliedMovieShowtimeFilterState] =
    useState<SharedTabShowtimeFilter>('all');
  const applyMovieShowtimeFilterFrameRef = useRef<number | null>(null);
  const {
    watchlistOnly,
    appliedWatchlistOnly,
    setWatchlistOnly,
    sessionCinemaIds,
    selectedDays,
    setSelectedDays,
    selectedTimeRanges,
    setSelectedTimeRanges,
  } = useSharedTabFilters();
  const isFocused = useIsFocused();
  const dayAnchorKey =
    DateTime.now().setZone('Europe/Amsterdam').startOf('day').toISODate() ?? '';
  const resolvedApiDays = useMemo(
    () => resolveDaySelectionsForApi(selectedDays),
    [dayAnchorKey, selectedDays]
  );
  // Snapshot time is part of the query key so pull-to-refresh can force a full refresh.
  const [snapshotTime, setSnapshotTime] = useState(() =>
    DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss")
  );

  const { data: preferredCinemaIds } = useFetchSelectedCinemas();

  // Read the active theme color tokens used by this screen/component.
  const colors = useThemeColors();
  const styles = createStyles(colors);

  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  // Build the filter payload once per relevant state change to avoid unnecessary refetches.
  const movieFilters = useMemo<MovieFilters>(
    () => ({
      query: searchQuery,
      watchlistOnly: appliedWatchlistOnly ? true : undefined,
      days: resolvedApiDays,
      timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
      selectedCinemaIds: sessionCinemaIds,
      selectedStatuses: getSelectedStatusesFromShowtimeFilter(appliedMovieShowtimeFilter),
    }),
    [
      searchQuery,
      appliedWatchlistOnly,
      resolvedApiDays,
      selectedTimeRanges,
      sessionCinemaIds,
      appliedMovieShowtimeFilter,
    ]
  );

  const currentPresetFilters = useMemo<PageFilterPresetState>(
    () => ({
      selected_showtime_filter: selectedMovieShowtimeFilter,
      showtime_audience: 'including-friends',
      watchlist_only: watchlistOnly,
      days: selectedDays.length > 0 ? selectedDays : null,
      time_ranges: selectedTimeRanges.length > 0 ? selectedTimeRanges : null,
    }),
    [selectedMovieShowtimeFilter, watchlistOnly, selectedDays, selectedTimeRanges]
  );

  const setSelectedMovieShowtimeFilter = useCallback((next: SharedTabShowtimeFilter) => {
    setSelectedMovieShowtimeFilterState(next);
    if (applyMovieShowtimeFilterFrameRef.current !== null) {
      cancelAnimationFrame(applyMovieShowtimeFilterFrameRef.current);
    }
    applyMovieShowtimeFilterFrameRef.current = requestAnimationFrame(() => {
      applyMovieShowtimeFilterFrameRef.current = null;
      setAppliedMovieShowtimeFilterState(next);
    });
  }, []);

  useEffect(
    () => () => {
      if (applyMovieShowtimeFilterFrameRef.current !== null) {
        cancelAnimationFrame(applyMovieShowtimeFilterFrameRef.current);
      }
    },
    []
  );

  // Data hooks keep this module synced with backend data and shared cache state.
  const {
    data: moviesData,
    isLoading,
    isFetchingNextPage,
    isFetching,
    hasNextPage,
    fetchNextPage
  } = useFetchMovies({
    limit: 20,
    snapshotTime,
    filters: movieFilters,
    enabled: isFocused,
  });

  // Flatten paginated query results into one array for list rendering.
  const movies = moviesData?.pages.flat() || [];

  // Refresh the current dataset and reset any stale pagination state.
  const handleRefresh = async () => {
    setRefreshing(true);
    // Reset cached pages for the current filters, then bump snapshot to request fresh data.
    await resetInfiniteQuery(queryClient, ['movies', movieFilters]);
    setSnapshotTime(DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    setRefreshing(false);
  };

  // Render infinite-scroll loading feedback at the bottom of the list.
  const renderFooter = () => {
    if (!isFetchingNextPage) return null;
    return (
      <ThemedView style={styles.footerLoader}>
        <ActivityIndicator size="large" color={colors.tint} />
      </ThemedView>
    );
  };

  // Render the empty/loading state when list data is unavailable.
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

  // Request the next page when the list nears the end.
  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  // Handle filter pill presses and update active filter state.
  const handleSelectFilter = (filterId: SharedTabFilterId) => {
    if (filterId === 'showtime-filter') {
      setSelectedMovieShowtimeFilter(
        cycleSharedTabShowtimeFilter(selectedMovieShowtimeFilter)
      );
      return;
    }
    if (filterId === 'watchlist-only') {
      setWatchlistOnly(!watchlistOnly);
      return;
    }
    if (filterId === 'cinemas') {
      setCinemaModalVisible(true);
      return;
    }
    if (filterId === 'days') {
      setDayModalVisible(true);
      return;
    }
    if (filterId === 'times') {
      setTimeModalVisible(true);
      return;
    }
    if (filterId === 'presets') {
      setPresetModalVisible(true);
      return;
    }
  };

  const handleApplyPreset = (filters: PageFilterPresetState) => {
    setSelectedMovieShowtimeFilter(toSharedTabShowtimeFilter(filters.selected_showtime_filter));
    setWatchlistOnly(Boolean(filters.watchlist_only));
    setSelectedDays(filters.days ?? []);
    setSelectedTimeRanges(filters.time_ranges ?? []);
  };

  const handleLongPressFilter = (
    filterId: SharedTabFilterId,
    position: FilterPillLongPressPosition
  ) => {
    if (filterId !== 'cinemas') return false;
    setCinemaPresetPopoverAnchor(position);
    setCinemaPresetPopoverVisible(true);
    return true;
  };

  const pillFilters = useMemo(
    () => {
      const filters = buildSharedTabPillFilters({
        colors,
        selectedShowtimeFilter: selectedMovieShowtimeFilter,
        selectedDaysCount: selectedDays.length,
        selectedTimeRangesCount: selectedTimeRanges.length,
      });
      // Movies tab status pill should not draw the extra active border.
      return filters.map((filter) =>
        filter.id === 'showtime-filter' ? { ...filter, activeBorderColor: undefined } : filter
      );
    },
    [colors, selectedMovieShowtimeFilter, selectedDays.length, selectedTimeRanges.length]
  );

  // Cinema pill should only be active when current session differs from preferred cinemas.
  const isCinemaFilterActive = useMemo(
    () =>
      isCinemaSelectionDifferentFromPreferred({
        sessionCinemaIds,
        preferredCinemaIds,
      }),
    [sessionCinemaIds, preferredCinemaIds]
  );

  // These ids drive highlighted filter pills in the UI.
  const activeFilterIds = useMemo(
    () =>
      buildSharedTabActiveFilterIds({
        selectedShowtimeFilter: selectedMovieShowtimeFilter,
        watchlistOnly,
        selectedDaysCount: selectedDays.length,
        selectedTimeRangesCount: selectedTimeRanges.length,
        isCinemaFilterActive,
      }),
    [
      selectedMovieShowtimeFilter,
      watchlistOnly,
      selectedDays.length,
      selectedTimeRanges.length,
      isCinemaFilterActive,
    ]
  );

  // Render/output using the state and derived values prepared above.
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar />
      <SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder="Search movies" />
      <FilterPills
        filters={pillFilters}
        selectedId=""
        onSelect={handleSelectFilter}
        onLongPressSelect={handleLongPressFilter}
        activeIds={activeFilterIds}
      />
      <CinemaPresetQuickPopover
        visible={cinemaPresetPopoverVisible}
        anchor={cinemaPresetPopoverAnchor}
        onClose={() => setCinemaPresetPopoverVisible(false)}
        maxPresets={6}
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
      <TimeFilterModal
        visible={timeModalVisible}
        onClose={() => setTimeModalVisible(false)}
        selectedTimeRanges={selectedTimeRanges}
        onChange={setSelectedTimeRanges}
      />
      <FilterPresetsModal
        visible={presetModalVisible}
        onClose={() => setPresetModalVisible(false)}
        scope={SHARED_TAB_FILTER_PRESET_SCOPE}
        currentFilters={currentPresetFilters}
        onApply={handleApplyPreset}
      />

      {/* Movie Feed */}
      <FlatList
        data={movies}
        renderItem={({ item }) => (
          <MovieCard
            movie={item}
            onPress={(movie) => router.push(`/movie/${movie.id}`)}
          />
        )}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.movieFeed}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={2}
        refreshing={isLoading}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        }
      />
    </SafeAreaView>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    movieFeed: {
      padding: 16,
    },
    footerLoader: {
      paddingVertical: 20,
      alignItems: 'center',
    },
    centerContainer: {
      paddingVertical: 40,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
  });
