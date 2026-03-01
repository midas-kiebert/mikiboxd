/**
 * Expo Router screen/module for (tabs) / movies. It controls navigation and screen-level state for this route.
 */
import { useMemo, useState } from 'react';
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
import { DateTime } from 'luxon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import DayQuickPopover from '@/components/filters/DayQuickPopover';
import FilterPresetQuickPopover from '@/components/filters/FilterPresetQuickPopover';
import FilterPresetFab from '@/components/filters/FilterPresetFab';
import FilterPresetsModal, {
  type PageFilterPresetState,
} from '@/components/filters/FilterPresetsModal';
import TimeQuickPopover from '@/components/filters/TimeQuickPopover';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import {
  SHARED_TAB_FILTER_PRESET_SCOPE,
  buildSharedTabActiveFilterIds,
  buildSharedTabPillFilters,
  cycleSharedTabShowtimeFilter,
  getSelectedStatusesFromShowtimeFilter,
  toSharedTabShowtimeFilter,
  type SharedTabFilterId,
} from '@/components/filters/shared-tab-filters';
import { useThemeColors } from '@/hooks/use-theme-color';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';
import MovieCard from '@/components/movies/MovieCard';
import { isCinemaSelectionDifferentFromPreferred } from '@/utils/cinema-selection';
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from '@/utils/reset-infinite-query';

type AudienceFilter = 'including-friends' | 'only-you';
const toAudienceFilter = (
  value: PageFilterPresetState['showtime_audience'] | undefined
): AudienceFilter => (value === 'only-you' ? 'only-you' : 'including-friends');

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
  const [dayQuickPopoverVisible, setDayQuickPopoverVisible] = useState(false);
  const [dayQuickPopoverAnchor, setDayQuickPopoverAnchor] =
    useState<FilterPillLongPressPosition | null>(null);
  const [timeQuickPopoverVisible, setTimeQuickPopoverVisible] = useState(false);
  const [timeQuickPopoverAnchor, setTimeQuickPopoverAnchor] =
    useState<FilterPillLongPressPosition | null>(null);
  const [presetQuickPopoverVisible, setPresetQuickPopoverVisible] = useState(false);
  const [presetQuickPopoverAnchor, setPresetQuickPopoverAnchor] =
    useState<FilterPillLongPressPosition | null>(null);
  // Controls visibility of the day-filter modal.
  const [dayModalVisible, setDayModalVisible] = useState(false);
  // Controls visibility of the filter-presets modal.
  const [presetModalVisible, setPresetModalVisible] = useState(false);
  const {
    selectedShowtimeFilter,
    appliedShowtimeFilter,
    setSelectedShowtimeFilter,
    selectedShowtimeAudience,
    appliedShowtimeAudience,
    setSelectedShowtimeAudience,
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
  const shouldShowAudienceToggle = selectedShowtimeFilter !== 'all';
  const effectiveAudienceFilter: AudienceFilter = shouldShowAudienceToggle
    ? appliedShowtimeAudience
    : 'including-friends';
  // Snapshot timestamp used to keep paginated API responses consistent.
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());

  const { data: preferredCinemaIds } = useFetchSelectedCinemas();
  const { data: cinemaPresets = [] } = useQuery({
    queryKey: ['cinema-presets'],
    queryFn: () => MeService.getCinemaPresets(),
  });

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
      selectedStatuses: getSelectedStatusesFromShowtimeFilter(appliedShowtimeFilter),
    }),
    [
      searchQuery,
      appliedWatchlistOnly,
      resolvedApiDays,
      selectedTimeRanges,
      sessionCinemaIds,
      appliedShowtimeFilter,
    ]
  );

  const currentPresetFilters = useMemo<PageFilterPresetState>(
    () => ({
      selected_showtime_filter: selectedShowtimeFilter,
      showtime_audience: shouldShowAudienceToggle ? selectedShowtimeAudience : 'including-friends',
      watchlist_only: watchlistOnly,
      days: selectedDays.length > 0 ? selectedDays : null,
      time_ranges: selectedTimeRanges.length > 0 ? selectedTimeRanges : null,
    }),
    [
      selectedShowtimeFilter,
      shouldShowAudienceToggle,
      selectedShowtimeAudience,
      watchlistOnly,
      selectedDays,
      selectedTimeRanges,
    ]
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
  const visibleMovies = useMemo(() => {
    if (effectiveAudienceFilter !== 'only-you') return movies;
    const selectedStatuses = getSelectedStatusesFromShowtimeFilter(appliedShowtimeFilter);
    if (!selectedStatuses || selectedStatuses.length === 0) return movies;
    return movies.filter((movie) => selectedStatuses.includes(movie.going));
  }, [appliedShowtimeFilter, effectiveAudienceFilter, movies]);

  // Refresh the current dataset and reset any stale pagination state.
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Reset cached pages for the current filters, then bump snapshot to request fresh data.
      await refreshInfiniteQueryWithFreshSnapshot({
        queryClient,
        queryKey: ['movies', movieFilters],
        setSnapshotTime,
      });
    } finally {
      setRefreshing(false);
    }
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
        <ThemedText style={styles.emptyText}>
          {effectiveAudienceFilter === 'only-you' ? 'No movies in your agenda' : 'No movies found'}
        </ThemedText>
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
  const handleSelectFilter = (
    filterId: SharedTabFilterId,
    position?: FilterPillLongPressPosition
  ) => {
    if (filterId === 'showtime-filter') {
      setSelectedShowtimeFilter(cycleSharedTabShowtimeFilter(selectedShowtimeFilter));
      return;
    }
    if (filterId === 'watchlist-only') {
      setWatchlistOnly(!watchlistOnly);
      return;
    }
    if (filterId === 'cinemas') {
      setCinemaPresetPopoverAnchor(position ?? null);
      setCinemaPresetPopoverVisible(true);
      return;
    }
    if (filterId === 'days') {
      setDayQuickPopoverAnchor(position ?? null);
      setDayQuickPopoverVisible(true);
      return;
    }
    if (filterId === 'times') {
      setTimeQuickPopoverAnchor(position ?? null);
      setTimeQuickPopoverVisible(true);
      return;
    }
    if (filterId === 'presets') {
      setPresetModalVisible(true);
      return;
    }
  };

  const handleApplyPreset = (filters: PageFilterPresetState) => {
    setSelectedShowtimeFilter(toSharedTabShowtimeFilter(filters.selected_showtime_filter));
    setSelectedShowtimeAudience(toAudienceFilter(filters.showtime_audience));
    setWatchlistOnly(Boolean(filters.watchlist_only));
    setSelectedDays(filters.days ?? []);
    setSelectedTimeRanges(filters.time_ranges ?? []);
  };

  const handleLongPressFilter = (
    filterId: SharedTabFilterId,
    position: FilterPillLongPressPosition
  ) => {
    if (filterId === 'cinemas') {
      setCinemaModalVisible(true);
      return true;
    }
    if (filterId === 'days') {
      setDayModalVisible(true);
      return true;
    }
    if (filterId === 'times') {
      setTimeQuickPopoverAnchor(position ?? null);
      setTimeQuickPopoverVisible(true);
      return true;
    }
    return false;
  };

  const pillFilters = useMemo(
    () => {
      const filters = buildSharedTabPillFilters({
        colors,
        selectedShowtimeFilter,
        watchlistOnly,
        selectedDays,
        selectedTimeRanges,
        sessionCinemaIds,
        preferredCinemaIds,
        cinemaPresets,
      });
      return filters.filter((filter) => filter.id !== 'presets');
    },
    [
      cinemaPresets,
      colors,
      preferredCinemaIds,
      selectedDays,
      selectedShowtimeFilter,
      selectedTimeRanges,
      sessionCinemaIds,
      watchlistOnly,
    ]
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
        selectedShowtimeFilter,
        watchlistOnly,
        selectedDaysCount: selectedDays.length,
        selectedTimeRangesCount: selectedTimeRanges.length,
        isCinemaFilterActive,
      }),
    [
      selectedShowtimeFilter,
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
        compoundRightToggle={
          shouldShowAudienceToggle
            ? {
                anchorId: 'showtime-filter',
                label: selectedShowtimeAudience === 'only-you' ? 'Only You' : 'Including Friends',
                onPress: () =>
                  setSelectedShowtimeAudience(
                    selectedShowtimeAudience === 'only-you' ? 'including-friends' : 'only-you'
                  ),
              }
            : undefined
        }
      />
      <CinemaPresetQuickPopover
        visible={cinemaPresetPopoverVisible}
        anchor={cinemaPresetPopoverAnchor}
        onClose={() => setCinemaPresetPopoverVisible(false)}
        onOpenModal={() => setCinemaModalVisible(true)}
        maxPresets={6}
      />
      <DayQuickPopover
        visible={dayQuickPopoverVisible}
        anchor={dayQuickPopoverAnchor}
        onClose={() => setDayQuickPopoverVisible(false)}
        selectedDays={selectedDays}
        onChange={setSelectedDays}
        onOpenModal={() => setDayModalVisible(true)}
      />
      <TimeQuickPopover
        visible={timeQuickPopoverVisible}
        anchor={timeQuickPopoverAnchor}
        onClose={() => setTimeQuickPopoverVisible(false)}
        selectedTimeRanges={selectedTimeRanges}
        onChange={setSelectedTimeRanges}
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
      <FilterPresetsModal
        visible={presetModalVisible}
        onClose={() => setPresetModalVisible(false)}
        scope={SHARED_TAB_FILTER_PRESET_SCOPE}
        currentFilters={currentPresetFilters}
        onApply={handleApplyPreset}
      />

      {/* Movie Feed */}
      <FlatList
        data={visibleMovies}
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
      <FilterPresetFab
        isPopoverVisible={presetQuickPopoverVisible}
        onOpen={(anchor) => {
          setPresetQuickPopoverAnchor(anchor);
          setPresetQuickPopoverVisible(true);
        }}
        onLongPress={() => setPresetModalVisible(true)}
      />
      <FilterPresetQuickPopover
        visible={presetQuickPopoverVisible}
        anchor={presetQuickPopoverAnchor}
        onClose={() => setPresetQuickPopoverVisible(false)}
        onOpenModal={() => setPresetModalVisible(true)}
        scope={SHARED_TAB_FILTER_PRESET_SCOPE}
        currentFilters={currentPresetFilters}
        onApply={handleApplyPreset}
        maxPresets={6}
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
