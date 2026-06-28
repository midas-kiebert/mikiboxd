/**
 * Expo Router screen/module for friend-showtimes / [id]. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, SectionList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedRefreshControl } from '@/components/themed-refresh-control';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DateTime } from 'luxon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UsersService, type GoingStatus, type ShowtimeLoggedIn } from 'shared';
import { useFetchUserShowtimes } from 'shared/hooks/useFetchUserShowtimes';
import useAuth from 'shared/hooks/useAuth';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import ShowtimesScreen, { ListEndFooter, ShowtimesScreenSkeleton } from '@/components/showtimes/ShowtimesScreen';
import { useDeferredMount } from '@/utils/use-deferred-mount';
import FiltersButtonRow from '@/components/filters/FiltersButtonRow';
import FiltersModal from '@/components/filters/FiltersModal';
import CinemaFilterModal from '@/components/filters/CinemaFilterModal';
import ActiveFilterChips from '@/components/filters/ActiveFilterChips';
import ShowtimeCard from '@/components/showtimes/ShowtimeCard';
import { SkeletonRows } from '@/components/ui/SkeletonRows';
import { useShowtimeModal } from '@/components/showtimes/ShowtimeModalProvider';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/hooks/use-theme-color';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from '@/utils/reset-infinite-query';
import { triggerLongPressHaptic } from '@/utils/long-press';

const EMPTY_DAYS: string[] = [];
const EMPTY_TIME_RANGES: string[] = [];

const getRouteParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const getFriendTitle = (displayName: string | null | undefined) => {
  const trimmedDisplayName = displayName?.trim();
  if (trimmedDisplayName) return trimmedDisplayName;
  return 'Agenda';
};

type MovieSection = {
  key: string;
  title: string;
  posterLink: string | null | undefined;
  data: ShowtimeLoggedIn[];
};

export default function FriendShowtimesScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const ready = useDeferredMount(`friend:${Array.isArray(id) ? id[0] : id}`);
  if (!ready) {
    return <ShowtimesScreenSkeleton topBarTitle="Agenda" topBarShowBackButton />;
  }
  return <FriendShowtimesContent id={id} />;
}

function FriendShowtimesContent({ id }: { id?: string | string[] }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const { openShowtimeModal } = useShowtimeModal();
  const { user } = useAuth();
  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());
  const userId = useMemo(() => getRouteParam(id), [id]);
  const [searchQuery, setSearchQuery] = useState('');
  // Independent toggle: not inherited from shared state (own thing per user visit).
  const [includeInterested, setIncludeInterested] = useState(true);
  const [filtersModalVisible, setFiltersModalVisible] = useState(false);
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
    groupByMovie,
    setGroupByMovie,
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

  const { data: friend } = useQuery({
    queryKey: ['user', userId],
    enabled: !!userId,
    queryFn: () => UsersService.getUser({ userId: userId! }),
  });

  const topBarTitle = useMemo(
    () => (friend ? getFriendTitle(friend.display_name) : 'Agenda'),
    [friend]
  );

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
    enabled: !!userId,
  });

  const showtimes = useMemo(() => data?.pages.flat() ?? [], [data]);

  // Client-side grouping by movie for the "group by movies" view.
  const movieSections = useMemo<MovieSection[]>(() => {
    if (!groupByMovie) return [];
    const map = new Map<number, MovieSection>();
    for (const showtime of showtimes) {
      const movie = showtime.movie;
      if (!map.has(movie.id)) {
        map.set(movie.id, { key: String(movie.id), title: movie.title, posterLink: movie.poster_link, data: [] });
      }
      map.get(movie.id)!.data.push(showtime);
    }
    return Array.from(map.values());
  }, [showtimes, groupByMovie]);

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
    setGroupByMovie(false);
    setSelectedDays([]);
    setSelectedTimeRanges([]);
    setSelectedListIds([]);
    setExcludeListIds([]);
    setSelectedLanguages([]);
    if (preferredCinemaIds) setSessionCinemaIds(preferredCinemaIds);
  };

  const interestedToggle = (
    <TouchableOpacity
      onPress={() => { triggerLongPressHaptic(); setIncludeInterested((v) => !v); }}
      activeOpacity={0.7}
      accessibilityRole="switch"
      accessibilityState={{ checked: includeInterested }}
      accessibilityLabel={`${includeInterested ? 'Hide' : 'Show'} interested`}
      style={[
        styles.toggle,
        includeInterested
          ? { backgroundColor: colors.orange.primary, borderColor: colors.orange.primary }
          : { backgroundColor: colors.pillBackground, borderColor: colors.cardBorder },
      ]}
    >
      <MaterialIcons
        name={includeInterested ? 'bookmark' : 'bookmark-border'}
        size={15}
        color={includeInterested ? colors.orange.secondary : colors.textSecondary}
      />
      <ThemedText style={[styles.toggleLabel, { color: includeInterested ? colors.orange.secondary : colors.textSecondary }]}>
        Interested
      </ThemedText>
    </TouchableOpacity>
  );

  // Clear sections while refreshing so pull-to-refresh visibly reloads, even
  // when the refetched data is unchanged.
  const visibleMovieSections = refreshing ? [] : movieSections;

  const moviesContent = groupByMovie ? (
    <SectionList
      style={styles.flex}
      sections={visibleMovieSections}
      keyExtractor={(item) => item.id.toString()}
      renderSectionHeader={({ section }) => (
        <View style={styles.movieSectionHeader}>
          {section.posterLink ? (
            <Image source={{ uri: section.posterLink }} style={styles.movieSectionPoster} />
          ) : null}
          <ThemedText style={styles.movieSectionTitle} numberOfLines={2}>{section.title}</ThemedText>
        </View>
      )}
      renderItem={({ item }) => (
        <ShowtimeCard
          showtime={item}
          onPress={(st) => openShowtimeModal(st, { openedFrom: { userId: userId ?? undefined } })}
          onLongPress={(st) =>
            router.push({
              pathname: "/movie/[id]",
              params: { id: String(st.movie.id), cinemaId: String(st.cinema.id) },
            })
          }
        />
      )}
      contentContainerStyle={styles.movieSectionContent}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        isLoading || isFetching || refreshing ? (
          <SkeletonRows height={112} />
        ) : (
          <View style={styles.centerContainer}>
            <ThemedText style={styles.emptyText}>No showtimes in this agenda</ThemedText>
          </View>
        )
      }
      ListFooterComponent={
        isFetchingNextPage ? (
          <View style={styles.footerLoader}>
            <ActivityIndicator size="small" color={colors.tint} />
          </View>
        ) : !hasNextPage && !isLoading && !isFetching && !refreshing && showtimes.length > 0 ? (
          <ListEndFooter label="No more showtimes" />
        ) : null
      }
      onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
      onEndReachedThreshold={2}
      refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    />
  ) : undefined;

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
        filterRow={
          <>
            <FiltersButtonRow
              onPress={() => setFiltersModalVisible(true)}
              rightSlot={interestedToggle}
            />
            <ActiveFilterChips
              onOpenFilters={() => setFiltersModalVisible(true)}
              onOpenCinemaModal={() => setCinemaModalVisible(true)}
              groupByMovie={groupByMovie}
              setGroupByMovie={setGroupByMovie}
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
        listContent={moviesContent}
        emptyText="No showtimes in this agenda"
        openModalOptions={{ openedFrom: { userId: userId ?? undefined } }}
      />
      <FiltersModal
        visible={filtersModalVisible}
        onClose={() => setFiltersModalVisible(false)}
        groupByMovie={groupByMovie}
        setGroupByMovie={setGroupByMovie}
        showGroupByMovie
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
        resultCount={groupByMovie ? movieSections.length : showtimes.length}
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
    flex: { flex: 1 },
    toggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 18,
      borderWidth: 1,
    },
    toggleLabel: {
      fontSize: 13,
      fontWeight: '500',
    },
    movieSectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    movieSectionPoster: {
      width: 36,
      height: 54,
      borderRadius: 4,
      backgroundColor: colors.posterPlaceholder,
    },
    movieSectionTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: '700',
    },
    movieSectionContent: {
      paddingTop: 12,
      paddingHorizontal: 16,
      paddingBottom: 16,
    },
    centerContainer: { paddingVertical: 40, alignItems: 'center' },
    emptyText: { fontSize: 16, color: colors.textSecondary },
    footerLoader: { paddingVertical: 20, alignItems: 'center' },
  });
