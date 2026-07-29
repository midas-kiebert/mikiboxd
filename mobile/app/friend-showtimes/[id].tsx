/**
 * Expo Router screen/module for friend-showtimes / [id]. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { DateTime } from 'luxon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UsersService, type GoingStatus, type UserWithFriendStatus } from 'shared';
import { useFetchUserShowtimes } from 'shared/hooks/useFetchUserShowtimes';
import { usePrefetchShowtimeVisibility } from 'shared/hooks/useShowtimeVisibility';
import useAuth from 'shared/hooks/useAuth';

import ShowtimesScreen, {
  ActiveFilterChipsPlaceholder,
  ShowtimesScreenSkeleton,
} from '@/components/showtimes/ShowtimesScreen';
import TopSafeAreaView from '@/components/layout/TopSafeAreaView';
import TopBar from '@/components/layout/TopBar';
import { useDeferredMount } from '@/utils/use-deferred-mount';
import FiltersButtonRow from '@/components/filters/FiltersButtonRow';
import FiltersModal from '@/components/filters/FiltersModal';
import CinemaFilterModal from '@/components/filters/CinemaFilterModal';
import ActiveFilterChips from '@/components/filters/ActiveFilterChips';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import FriendAgendaOptions from '@/components/friends/FriendAgendaOptions';
import NonFriendProfile from '@/components/friends/NonFriendProfile';
import AgendaTogglePill from '@/components/showtimes/AgendaTogglePill';
import { useThemeColors } from '@/hooks/use-theme-color';
import { getAvatarColors, getAvatarInitial } from '@/utils/avatar-color';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from '@/utils/reset-infinite-query';

const EMPTY_DAYS: string[] = [];
const EMPTY_TIME_RANGES: string[] = [];
const NOOP_GROUP_BY_MOVIE = () => {};

const getRouteParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const getFriendTitle = (displayName: string | null | undefined) => {
  const trimmedDisplayName = displayName?.trim();
  if (trimmedDisplayName) return trimmedDisplayName;
  return 'Agenda';
};

/**
 * A friend's agenda is nothing but showtimes, so everything above the list —
 * the top bar, the search field, the Filters button and the Interested toggle —
 * is the screen's frame rather than something the data decides. It is owned
 * here, above the deferred-mount split, so it paints and answers taps on the
 * first frame; whatever the user types or opens while the content below is
 * still mounting carries straight over, because it was never the content's
 * state to begin with.
 */
export default function FriendShowtimesScreen() {
  const { id, name } = useLocalSearchParams<{ id?: string | string[]; name?: string | string[] }>();
  const ready = useDeferredMount(`friend:${Array.isArray(id) ? id[0] : id}`);
  const routeFriendName = getFriendTitle(getRouteParam(name));
  const [searchQuery, setSearchQuery] = useState('');
  // Independent toggle: not inherited from shared state (own thing per user visit).
  const [includeInterested, setIncludeInterested] = useState(true);
  const [filtersModalVisible, setFiltersModalVisible] = useState(false);
  const colors = useThemeColors();
  // Derived from the route params alone, so the color-coded initial paints on
  // the very first frame instead of waiting on the friend-status fetch.
  const routeAvatarColors = getAvatarColors(getRouteParam(id) ?? '', colors);
  const topBarAccentColor = { background: routeAvatarColors.primary, text: routeAvatarColors.secondary };
  const topBarAvatarInitial = getAvatarInitial(routeFriendName);

  // Same pill and wording as the Interested toggle on your own Agenda tab —
  // a friend's agenda is read the same way as your own — but here it rides in
  // the Filters row's right slot, next to the Filters button.
  const filtersButtonRow = (
    <FiltersButtonRow
      onPress={() => setFiltersModalVisible(true)}
      rightSlot={
        <AgendaTogglePill
          label="Interested"
          iconOn="bookmark"
          iconOff="bookmark-border"
          active={includeInterested}
          accent={colors.orange}
          onToggle={() => setIncludeInterested((previous) => !previous)}
        />
      }
    />
  );

  if (!ready) {
    return (
      <ShowtimesScreenSkeleton
        topBarTitle={routeFriendName}
        topBarAccentColor={topBarAccentColor}
        topBarAvatarInitial={topBarAvatarInitial}
        topBarShowBackButton
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filterRow={
          <>
            {filtersButtonRow}
            <ActiveFilterChipsPlaceholder />
          </>
        }
      />
    );
  }
  return (
    <FriendShowtimesContent
      id={id}
      routeFriendName={routeFriendName}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      includeInterested={includeInterested}
      filtersButtonRow={filtersButtonRow}
      filtersModalVisible={filtersModalVisible}
      setFiltersModalVisible={setFiltersModalVisible}
    />
  );
}

function FriendShowtimesContent({
  id,
  routeFriendName,
  searchQuery,
  onSearchChange,
  includeInterested,
  filtersButtonRow,
  filtersModalVisible,
  setFiltersModalVisible,
}: {
  id?: string | string[];
  routeFriendName: string;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  includeInterested: boolean;
  filtersButtonRow: ReactElement;
  filtersModalVisible: boolean;
  setFiltersModalVisible: (visible: boolean) => void;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { user } = useAuth();
  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());
  const userId = useMemo(() => getRouteParam(id), [id]);
  const [cinemaModalVisible, setCinemaModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());

  const {
    watchlistOnly,
    appliedWatchlistOnly,
    setWatchlistOnly,
    watchlistExclude,
    setWatchlistExclude,
    hideWatched,
    appliedHideWatched,
    setHideWatched,
    watchedOnly,
    setWatchedOnly,
    selectedDays: sharedSelectedDays,
    setSelectedDays,
    selectedTimeRanges: sharedSelectedTimeRanges,
    setSelectedTimeRanges,
    selectedListIds,
    setSelectedListIds,
    excludeListIds,
    setExcludeListIds,
    selectedLanguages,
    setSelectedLanguages,
    sessionCinemaIds,
    setSessionCinemaIds,
  } = useSharedTabFilters();
  const { data: preferredCinemaIds } = useFetchSelectedCinemas();
  const effectiveCinemaIds = sessionCinemaIds ?? preferredCinemaIds;

  const effectiveWatchlistOnly = hasLetterboxdUsername ? watchlistOnly : false;
  const effectiveAppliedWatchlistOnly = hasLetterboxdUsername ? appliedWatchlistOnly : false;
  const effectiveWatchlistExclude = hasLetterboxdUsername ? watchlistExclude : false;
  const effectiveHideWatched = hasLetterboxdUsername ? hideWatched : false;
  const effectiveAppliedHideWatched = hasLetterboxdUsername ? appliedHideWatched : false;
  const effectiveWatchedOnly = hasLetterboxdUsername ? watchedOnly : false;
  const selectedDays = sharedSelectedDays ?? EMPTY_DAYS;
  const selectedTimeRanges = sharedSelectedTimeRanges ?? EMPTY_TIME_RANGES;

  const dayAnchorKey =
    DateTime.now().setZone('Europe/Amsterdam').startOf('day').toISODate() ?? '';
  const resolvedApiDays = useMemo(
    () =>
      resolveDaySelectionsForApi(selectedDays, {
        startDate: DateTime.fromISO(dayAnchorKey, { zone: "Europe/Amsterdam" }),
      }),
    [dayAnchorKey, selectedDays]
  );

  useEffect(() => {
    if (hasLetterboxdUsername || !watchlistOnly) return;
    setWatchlistOnly(false);
  }, [hasLetterboxdUsername, setWatchlistOnly, watchlistOnly]);

  useEffect(() => {
    if (hasLetterboxdUsername || !hideWatched) return;
    setHideWatched(false);
  }, [hasLetterboxdUsername, setHideWatched, hideWatched]);

  const queryClient = useQueryClient();

  // Same query key/shape `useFriendStatus` polls elsewhere (e.g. a showtime's
  // invite list), so a change made from either place lands here too.
  const { data: friend } = useQuery<UserWithFriendStatus>({
    queryKey: ['users', 'friendStatus', userId],
    enabled: !!userId,
    queryFn: () => UsersService.getUserFriendStatus({ userId: userId! }),
    refetchInterval: 10000,
  });

  const topBarTitle = useMemo(
    () => (friend ? getFriendTitle(friend.display_name) : routeFriendName),
    [friend, routeFriendName]
  );

  // Derived from the route id/name alone (never from the friend-status fetch),
  // so the color-coded initial paints on the very first frame.
  const topBarAvatarColors = useMemo(() => getAvatarColors(userId ?? '', colors), [userId, colors]);
  const topBarAccentColor = useMemo(
    () => ({ background: topBarAvatarColors.primary, text: topBarAvatarColors.secondary }),
    [topBarAvatarColors]
  );
  const topBarAvatarInitial = useMemo(() => getAvatarInitial(topBarTitle), [topBarTitle]);

  const showtimesFilters = useMemo(() => ({
    query: searchQuery || undefined,
    days: resolvedApiDays,
    selectedCinemaIds: effectiveCinemaIds ?? undefined,
    timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
    selectedStatuses: (includeInterested ? ['GOING', 'INTERESTED'] : ['GOING']) as GoingStatus[],
    watchlistOnly: effectiveAppliedWatchlistOnly ? true : undefined,
    watchlistExclude: effectiveWatchlistExclude ? true : undefined,
    hideWatched: effectiveAppliedHideWatched ? true : undefined,
    watchedOnly: effectiveWatchedOnly ? true : undefined,
    selectedListIds: selectedListIds.length > 0 ? selectedListIds : undefined,
    excludeListIds: excludeListIds.length > 0 ? excludeListIds : undefined,
    selectedLanguages: selectedLanguages.length > 0 ? selectedLanguages : undefined,
  }), [
    effectiveAppliedWatchlistOnly,
    effectiveWatchlistExclude,
    effectiveAppliedHideWatched,
    effectiveWatchedOnly,
    selectedListIds,
    excludeListIds,
    selectedLanguages,
    effectiveCinemaIds,
    includeInterested,
    resolvedApiDays,
    searchQuery,
    selectedTimeRanges,
  ]);

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
    // Only a friend's showtimes are visible to the viewer at all; fetching
    // before friendship is confirmed would just be a wasted round trip.
    enabled: !!userId && Boolean(friend?.is_friend),
  });

  const showtimes = useMemo(() => data?.pages.flat() ?? [], [data]);
  usePrefetchShowtimeVisibility(showtimes.map((showtime) => showtime.id));

  const handleRefresh = async () => {
    if (!userId) return;
    setRefreshing(true);
    try {
      await refreshInfiniteQueryWithFreshSnapshot({
        queryClient,
        queryKey: ['showtimes', 'user', userId, showtimesFilters],
        setSnapshotTime,
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  const handleClearAll = () => {
    setWatchlistOnly(false);
    setWatchlistExclude(false);
    setHideWatched(false);
    setWatchedOnly(false);
    setSelectedDays([]);
    setSelectedTimeRanges([]);
    setSelectedListIds([]);
    setExcludeListIds([]);
    setSelectedLanguages([]);
    if (preferredCinemaIds) setSessionCinemaIds(preferredCinemaIds);
  };

  // Whether the viewer can even see this — resolved once the friend-status
  // fetch lands. Until then, a bare loading state rather than a guess: this
  // route is also reached for people the viewer isn't friends with (a
  // showtime's non-friend participant rows, watched/watchlisted lists), so
  // assuming "friend" while loading would flash their showtimes and
  // friend-only controls at a viewer who was never supposed to see them.
  if (!friend) {
    return (
      <TopSafeAreaView style={styles.container}>
        <TopBar
          title={routeFriendName}
          showBackButton
          accentColor={topBarAccentColor}
          avatarInitial={topBarAvatarInitial}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      </TopSafeAreaView>
    );
  }

  if (!friend.is_friend) {
    return (
      <TopSafeAreaView style={styles.container}>
        <TopBar
          title={topBarTitle}
          showBackButton
          accentColor={topBarAccentColor}
          avatarInitial={topBarAvatarInitial}
        />
        <NonFriendProfile user={friend} />
      </TopSafeAreaView>
    );
  }

  return (
    <>
      <ShowtimesScreen
        topBarTitle={topBarTitle}
        topBarAccentColor={topBarAccentColor}
        topBarAvatarInitial={topBarAvatarInitial}
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
        onSearchChange={onSearchChange}
        filterRow={
          <>
            <FriendAgendaOptions
              friendId={friend.id}
              friendName={topBarTitle}
              sharesStatus={friend.shares_status ?? true}
            />
            {filtersButtonRow}
            <ActiveFilterChips
              onOpenFilters={() => setFiltersModalVisible(true)}
              onOpenCinemaModal={() => setCinemaModalVisible(true)}
              groupByMovie={false}
              setGroupByMovie={NOOP_GROUP_BY_MOVIE}
              watchlistOnly={effectiveWatchlistOnly}
              setWatchlistOnly={setWatchlistOnly}
              watchlistExclude={effectiveWatchlistExclude}
              setWatchlistExclude={setWatchlistExclude}
              hideWatched={effectiveHideWatched}
              setHideWatched={setHideWatched}
              watchedOnly={effectiveWatchedOnly}
              setWatchedOnly={setWatchedOnly}
              canUseWatchlistFilter={hasLetterboxdUsername}
              selectedShowtimeFilter="all"
              setSelectedShowtimeFilter={() => {}}
              showStatusFilter={false}
              selectedDays={selectedDays}
              setSelectedDays={setSelectedDays}
              selectedTimeRanges={selectedTimeRanges}
              setSelectedTimeRanges={setSelectedTimeRanges}
              selectedRuntimeRanges={[]}
              setSelectedRuntimeRanges={() => {}}
              selectedListIds={selectedListIds}
              setSelectedListIds={setSelectedListIds}
              excludeListIds={excludeListIds}
              setExcludeListIds={setExcludeListIds}
              selectedLanguages={selectedLanguages}
              setSelectedLanguages={setSelectedLanguages}
              onClearAll={handleClearAll}
            />
          </>
        }
        emptyText="No showtimes in this agenda"
        openModalOptions={{ openedFrom: { userId: userId ?? undefined } }}
      />
      <FiltersModal
        visible={filtersModalVisible}
        onClose={() => setFiltersModalVisible(false)}
        groupByMovie={false}
        setGroupByMovie={NOOP_GROUP_BY_MOVIE}
        watchlistOnly={effectiveWatchlistOnly}
        setWatchlistOnly={setWatchlistOnly}
        watchlistExclude={effectiveWatchlistExclude}
        setWatchlistExclude={setWatchlistExclude}
        hideWatched={effectiveHideWatched}
        setHideWatched={setHideWatched}
        watchedOnly={effectiveWatchedOnly}
        setWatchedOnly={setWatchedOnly}
        canUseWatchlistFilter={hasLetterboxdUsername}
        selectedShowtimeFilter="all"
        setSelectedShowtimeFilter={() => {}}
        showStatusFilter={false}
        showCinemas
        onOpenCinemaModal={() => setCinemaModalVisible(true)}
        showRuntime={false}
        selectedDays={selectedDays}
        setSelectedDays={setSelectedDays}
        selectedTimeRanges={selectedTimeRanges}
        setSelectedTimeRanges={setSelectedTimeRanges}
        selectedRuntimeRanges={[]}
        setSelectedRuntimeRanges={() => {}}
        selectedListIds={selectedListIds}
        setSelectedListIds={setSelectedListIds}
        excludeListIds={excludeListIds}
        setExcludeListIds={setExcludeListIds}
        selectedLanguages={selectedLanguages}
        setSelectedLanguages={setSelectedLanguages}
        showLists
        resultCount={showtimes.length}
      />
      <CinemaFilterModal
        visible={cinemaModalVisible}
        onClose={() => setCinemaModalVisible(false)}
      />
    </>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  });
