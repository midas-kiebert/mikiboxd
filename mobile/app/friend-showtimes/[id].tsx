/**
 * Expo Router screen/module for friend-showtimes / [id]. It controls navigation and screen-level state for this route.
 */
import { useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { DateTime } from 'luxon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UsersService, type GoingStatus } from 'shared';
import { useFetchUserShowtimes } from 'shared/hooks/useFetchUserShowtimes';
import { useSessionShowtimeFilter } from 'shared/hooks/useSessionShowtimeFilter';

import ShowtimesScreen from '@/components/showtimes/ShowtimesScreen';
import DayFilterModal from '@/components/filters/DayFilterModal';
import DayQuickPopover from '@/components/filters/DayQuickPopover';
import { type FilterPillLongPressPosition } from '@/components/filters/FilterPills';
import TimeQuickPopover from '@/components/filters/TimeQuickPopover';
import { formatDayPillLabel, resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import { formatTimePillLabel } from '@/components/filters/time-range-utils';
import { useSharedDayTimeFilters } from '@/hooks/useSharedDayTimeFilters';
import { useThemeColors } from '@/hooks/use-theme-color';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';

// Filter pill definitions rendered in the top filter row.
const BASE_FILTERS = [
  { id: 'showtime-filter', label: 'Interested' },
  { id: 'watchlist-only', label: 'Watchlist Only' },
  { id: 'days', label: 'Any Day' },
  { id: 'times', label: 'any time' },
] as const;

type FriendAgendaFilterId = (typeof BASE_FILTERS)[number]['id'];
type FriendShowtimeFilter = 'interested' | 'going';

const getRouteParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const getFriendTitle = (displayName: string | null | undefined) => {
  const trimmedDisplayName = displayName?.trim();
  if (trimmedDisplayName) return trimmedDisplayName;
  return 'Agenda';
};

export default function FriendShowtimesScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const { selection: sharedShowtimeFilter } = useSessionShowtimeFilter();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const userId = useMemo(() => getRouteParam(id), [id]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedShowtimeFilter, setSelectedShowtimeFilter] = useState<FriendShowtimeFilter>(() =>
    sharedShowtimeFilter === 'going' ? 'going' : 'interested'
  );
  // Tracks which filter pills are toggled on (multi-select).
  const [activeFilterIds, setActiveFilterIds] = useState<FriendAgendaFilterId[]>([]);
  // Controls pull-to-refresh spinner visibility.
  const [refreshing, setRefreshing] = useState(false);
  // Controls visibility of the day-filter modal.
  const [dayModalVisible, setDayModalVisible] = useState(false);
  const [dayQuickPopoverVisible, setDayQuickPopoverVisible] = useState(false);
  const [dayQuickPopoverAnchor, setDayQuickPopoverAnchor] =
    useState<FilterPillLongPressPosition | null>(null);
  const [timeQuickPopoverVisible, setTimeQuickPopoverVisible] = useState(false);
  const [timeQuickPopoverAnchor, setTimeQuickPopoverAnchor] =
    useState<FilterPillLongPressPosition | null>(null);
  const { selectedDays, setSelectedDays, selectedTimeRanges, setSelectedTimeRanges } =
    useSharedDayTimeFilters();
  // Snapshot timestamp used to keep paginated API responses consistent.
  const [snapshotTime, setSnapshotTime] = useState(() =>
    DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss")
  );
  const dayAnchorKey =
    DateTime.now().setZone('Europe/Amsterdam').startOf('day').toISODate() ?? '';
  const resolvedApiDays = useMemo(
    () => resolveDaySelectionsForApi(selectedDays),
    [dayAnchorKey, selectedDays]
  );

  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  // Data hooks keep this module synced with backend data and shared cache state.
  const { data: friend } = useQuery({
    queryKey: ['user', userId],
    enabled: !!userId,
    queryFn: () => UsersService.getUser({ userId: userId! }),
  });

  const topBarTitle = useMemo(
    () => (friend ? getFriendTitle(friend.display_name) : 'Agenda'),
    [friend]
  );

  // Build the filter payload from current UI selections.
  const showtimesFilters = useMemo(() => {
    const selectedStatuses: GoingStatus[] =
      selectedShowtimeFilter === 'going' ? ['GOING'] : ['GOING', 'INTERESTED'];
    const watchlistOnly = activeFilterIds.includes('watchlist-only');

    return {
      query: searchQuery || undefined,
      days: resolvedApiDays,
      timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
      selectedStatuses,
      watchlistOnly: watchlistOnly ? true : undefined,
    };
  }, [activeFilterIds, resolvedApiDays, searchQuery, selectedShowtimeFilter, selectedTimeRanges]);

  // Data hooks keep this module synced with backend data and shared cache state.
  const {
    data,
    isLoading,
    isFetchingNextPage,
    isFetching,
    hasNextPage,
    fetchNextPage,
  } = useFetchUserShowtimes({
    limit: 20,
    snapshotTime,
    userId: userId ?? '',
    filters: showtimesFilters,
    enabled: !!userId,
  });

  // Flatten/derive list data for rendering efficiency.
  const showtimes = useMemo(() => data?.pages.flat() ?? [], [data]);

  // Refresh the current dataset and reset any stale pagination state.
  const handleRefresh = async () => {
    if (!userId) return;
    setRefreshing(true);
    await resetInfiniteQuery(queryClient, ['showtimes', 'user', userId, showtimesFilters]);
    setSnapshotTime(DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    setRefreshing(false);
  };

  // Request the next page when the list nears the end.
  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  // Handle filter pill presses and update active filter state.
  const handleToggleFilter = (
    filterId: FriendAgendaFilterId,
    position?: FilterPillLongPressPosition
  ) => {
    if (filterId === 'showtime-filter') {
      setSelectedShowtimeFilter((current) => (current === 'going' ? 'interested' : 'going'));
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
    setActiveFilterIds((prev) => {
      const isActive = prev.includes(filterId);
      return isActive ? prev.filter((idValue) => idValue !== filterId) : [...prev, filterId];
    });
  };

  const handleLongPressFilter = (
    filterId: FriendAgendaFilterId,
    position: FilterPillLongPressPosition
  ) => {
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
    () =>
      BASE_FILTERS.map((filter) =>
        filter.id === 'showtime-filter'
          ? {
              ...filter,
              label: selectedShowtimeFilter === 'going' ? 'Going' : 'Interested',
              activeBackgroundColor:
                selectedShowtimeFilter === 'going' ? colors.green.primary : colors.orange.primary,
              activeTextColor:
                selectedShowtimeFilter === 'going'
                  ? colors.green.secondary
                  : colors.orange.secondary,
              activeBorderColor:
                selectedShowtimeFilter === 'going'
                  ? colors.green.secondary
                  : colors.orange.secondary,
            }
          : filter.id === 'days'
          ? { ...filter, label: formatDayPillLabel(selectedDays) }
          : filter.id === 'times'
            ? { ...filter, label: formatTimePillLabel(selectedTimeRanges) }
            : filter
      ),
    [colors, selectedDays, selectedShowtimeFilter, selectedTimeRanges]
  );

  const highlightedFilterIds = useMemo(() => {
    const active: FriendAgendaFilterId[] = ['showtime-filter', ...activeFilterIds];
    if (selectedDays.length > 0) {
      active.push('days');
    }
    if (selectedTimeRanges.length > 0) {
      active.push('times');
    }
    return active;
  }, [activeFilterIds, selectedDays.length, selectedTimeRanges.length]);

  // Render/output using the state and derived values prepared above.
  return (
    <>
      <ShowtimesScreen
        topBarTitle={topBarTitle}
        topBarShowBackButton
        showtimes={showtimes}
        isLoading={isLoading}
        isFetching={isFetching}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
        onLoadMore={handleLoadMore}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filters={pillFilters}
        activeFilterIds={highlightedFilterIds}
        onToggleFilter={handleToggleFilter}
        onLongPressFilter={handleLongPressFilter}
        emptyText="No showtimes in this agenda"
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
      <DayFilterModal
        visible={dayModalVisible}
        onClose={() => setDayModalVisible(false)}
        selectedDays={selectedDays}
        onChange={setSelectedDays}
      />
    </>
  );
}
