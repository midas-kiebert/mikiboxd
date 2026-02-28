/**
 * Expo Router screen/module for (tabs) / index. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from '@react-navigation/native';
import { MeService } from 'shared';
import { useFetchMainPageShowtimes } from 'shared/hooks/useFetchMainPageShowtimes';
import { useFetchMyShowtimes } from 'shared/hooks/useFetchMyShowtimes';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';

import CinemaFilterModal from '@/components/filters/CinemaFilterModal';
import CinemaPresetQuickPopover from '@/components/filters/CinemaPresetQuickPopover';
import DayFilterModal from '@/components/filters/DayFilterModal';
import DayQuickPopover from '@/components/filters/DayQuickPopover';
import FilterPresetQuickPopover from '@/components/filters/FilterPresetQuickPopover';
import FilterPresetFab from '@/components/filters/FilterPresetFab';
import FilterPresetsModal, {
  type PageFilterPresetState,
} from '@/components/filters/FilterPresetsModal';
import { type FilterPillLongPressPosition } from '@/components/filters/FilterPills';
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
import ShowtimesScreen from '@/components/showtimes/ShowtimesScreen';
import { isCinemaSelectionDifferentFromPreferred } from '@/utils/cinema-selection';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';
import { useThemeColors } from '@/hooks/use-theme-color';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';

type AudienceFilter = 'including-friends' | 'only-you';
type MainShowtimesFilterId = SharedTabFilterId;
const toAudienceFilter = (
  value: PageFilterPresetState['showtime_audience'] | undefined
): AudienceFilter => (value === 'only-you' ? 'only-you' : 'including-friends');

export default function MainShowtimesScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const [searchQuery, setSearchQuery] = useState('');
  const [isFilterTransitionLoading, setIsFilterTransitionLoading] = useState(false);
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
  // Snapshot timestamp used to keep paginated API responses consistent.
  const [snapshotTime, setSnapshotTime] = useState(() =>
    DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss")
  );

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
  const shouldShowAudienceToggle = selectedShowtimeFilter !== 'all';
  const effectiveAudienceFilter: AudienceFilter = shouldShowAudienceToggle
    ? appliedShowtimeAudience
    : 'including-friends';

  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  // Build the filter payload from current UI selections.
  const showtimesFilters = useMemo(() => {
    return {
      query: searchQuery || undefined,
      selectedCinemaIds: sessionCinemaIds,
      days: resolvedApiDays,
      timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
      selectedStatuses: getSelectedStatusesFromShowtimeFilter(appliedShowtimeFilter),
      watchlistOnly: appliedWatchlistOnly ? true : undefined,
    };
  }, [
    searchQuery,
    appliedShowtimeFilter,
    resolvedApiDays,
    selectedTimeRanges,
    sessionCinemaIds,
    appliedWatchlistOnly,
  ]);

  const currentPresetFilters = useMemo<PageFilterPresetState>(
    () => ({
      selected_showtime_filter: selectedShowtimeFilter,
      showtime_audience: shouldShowAudienceToggle ? selectedShowtimeAudience : 'including-friends',
      watchlist_only: watchlistOnly,
      days: selectedDays.length > 0 ? selectedDays : null,
      time_ranges: selectedTimeRanges.length > 0 ? selectedTimeRanges : null,
    }),
    [
      selectedShowtimeAudience,
      selectedShowtimeFilter,
      selectedDays,
      selectedTimeRanges,
      shouldShowAudienceToggle,
      watchlistOnly,
    ]
  );

  // Build shared filter pills used by both Movies and Showtimes tabs.
  const sharedPillFilters = useMemo(
    () =>
      buildSharedTabPillFilters({
        colors,
        selectedShowtimeFilter,
        watchlistOnly,
        selectedDays,
        selectedTimeRanges,
        sessionCinemaIds,
        preferredCinemaIds,
        cinemaPresets,
      }),
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

  // Compute shared active filter ids used by both Movies and Showtimes tabs.
  const sharedActiveFilterIds = useMemo<SharedTabFilterId[]>(
    () =>
      buildSharedTabActiveFilterIds({
        selectedShowtimeFilter,
        watchlistOnly,
        selectedDaysCount: selectedDays.length,
        selectedTimeRangesCount: selectedTimeRanges.length,
        isCinemaFilterActive,
      }),
    [selectedShowtimeFilter, watchlistOnly, selectedDays.length, selectedTimeRanges.length, isCinemaFilterActive]
  );

  // Data hooks keep this module synced with backend data and shared cache state.
  const mainShowtimesQuery = useFetchMainPageShowtimes({
    limit: 20,
    snapshotTime,
    filters: showtimesFilters,
    enabled: isFocused && effectiveAudienceFilter === 'including-friends',
  });
  const myShowtimesQuery = useFetchMyShowtimes({
    limit: 20,
    snapshotTime,
    filters: showtimesFilters,
    enabled: isFocused && effectiveAudienceFilter === 'only-you',
  });
  const activeShowtimesQuery =
    effectiveAudienceFilter === 'only-you' ? myShowtimesQuery : mainShowtimesQuery;
  const {
    data,
    isLoading,
    isFetchingNextPage,
    isFetching,
    hasNextPage,
    fetchNextPage,
  } = activeShowtimesQuery;
  const isAudienceTransitionPending =
    shouldShowAudienceToggle && selectedShowtimeAudience !== appliedShowtimeAudience;
  const isAppliedFilterTransitionPending =
    selectedShowtimeFilter !== appliedShowtimeFilter ||
    watchlistOnly !== appliedWatchlistOnly ||
    isAudienceTransitionPending;

  // Flatten/derive list data for rendering efficiency.
  const showtimes = useMemo(() => data?.pages.flat() ?? [], [data]);
  const visibleShowtimes = isFilterTransitionLoading ? [] : showtimes;

  const startFilterTransitionLoading = () => {
    setIsFilterTransitionLoading(true);
  };

  useEffect(() => {
    if (!isFilterTransitionLoading) return;
    if (isAppliedFilterTransitionPending) return;

    const frame = requestAnimationFrame(() => {
      setIsFilterTransitionLoading(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [isAppliedFilterTransitionPending, isFilterTransitionLoading]);

  // Refresh the current dataset and reset any stale pagination state.
  const handleRefresh = async () => {
    setRefreshing(true);
    await resetInfiniteQuery(
      queryClient,
      effectiveAudienceFilter === 'only-you'
        ? ['showtimes', 'me', showtimesFilters]
        : ['showtimes', 'main', showtimesFilters]
    );
    setSnapshotTime(DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    setRefreshing(false);
  };

  // Request the next page when the list nears the end.
  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  // Handle filter pill presses and update filter state.
  const handleToggleFilter = (
    filterId: MainShowtimesFilterId,
    position?: FilterPillLongPressPosition
  ) => {
    if (filterId === 'showtime-filter') {
      startFilterTransitionLoading();
      setSelectedShowtimeFilter(cycleSharedTabShowtimeFilter(selectedShowtimeFilter));
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
    if (filterId === 'watchlist-only') {
      startFilterTransitionLoading();
      setWatchlistOnly(!watchlistOnly);
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
    filterId: MainShowtimesFilterId,
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
    () => sharedPillFilters.filter((filter) => filter.id !== 'presets'),
    [sharedPillFilters]
  );

  const activeFilterIds = useMemo<MainShowtimesFilterId[]>(
    () => [...sharedActiveFilterIds],
    [sharedActiveFilterIds]
  );

  // Render/output using the state and derived values prepared above.
  return (
    <>
      <ShowtimesScreen
        showtimes={visibleShowtimes}
        isLoading={isLoading || isFilterTransitionLoading}
        isFetching={isFetching || isFilterTransitionLoading}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
        onLoadMore={handleLoadMore}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filters={pillFilters}
        activeFilterIds={activeFilterIds}
        onToggleFilter={handleToggleFilter}
        onLongPressFilter={handleLongPressFilter}
        audienceToggle={
          shouldShowAudienceToggle
            ? {
                value: selectedShowtimeAudience,
                onChange: (value) => {
                  startFilterTransitionLoading();
                  setSelectedShowtimeAudience(value);
                },
              }
            : undefined
        }
        emptyText={
          effectiveAudienceFilter === 'only-you'
            ? 'No showtimes in your agenda'
            : 'No showtimes found'
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
    </>
  );
}
