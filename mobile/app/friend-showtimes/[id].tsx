/**
 * Expo Router screen/module for friend-showtimes / [id]. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, SectionList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DateTime } from 'luxon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UsersService, type GoingStatus, type ShowtimeLoggedIn } from 'shared';
import { useFetchUserShowtimes } from 'shared/hooks/useFetchUserShowtimes';
import useAuth from 'shared/hooks/useAuth';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import ShowtimesScreen from '@/components/showtimes/ShowtimesScreen';
import FiltersButtonRow from '@/components/filters/FiltersButtonRow';
import FiltersModal from '@/components/filters/FiltersModal';
import ActiveFilterChips from '@/components/filters/ActiveFilterChips';
import ShowtimeCard from '@/components/showtimes/ShowtimeCard';
import { useShowtimeModal } from '@/components/showtimes/ShowtimeModalProvider';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/hooks/use-theme-color';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';
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
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const { openShowtimeModal } = useShowtimeModal();
  const { user } = useAuth();
  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const userId = useMemo(() => getRouteParam(id), [id]);
  const [searchQuery, setSearchQuery] = useState('');
  // Independent toggle: not inherited from shared state (own thing per user visit).
  const [includeInterested, setIncludeInterested] = useState(true);
  const [filtersModalVisible, setFiltersModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());

  const {
    watchlistOnly,
    appliedWatchlistOnly,
    setWatchlistOnly,
    groupByMovie,
    setGroupByMovie,
    selectedDays: sharedSelectedDays,
    setSelectedDays,
    selectedTimeRanges: sharedSelectedTimeRanges,
    setSelectedTimeRanges,
  } = useSharedTabFilters();

  const effectiveWatchlistOnly = hasLetterboxdUsername ? watchlistOnly : false;
  const effectiveAppliedWatchlistOnly = hasLetterboxdUsername ? appliedWatchlistOnly : false;
  const selectedDays = sharedSelectedDays ?? EMPTY_DAYS;
  const selectedTimeRanges = sharedSelectedTimeRanges ?? EMPTY_TIME_RANGES;

  const dayAnchorKey =
    DateTime.now().setZone('Europe/Amsterdam').startOf('day').toISODate() ?? '';
  const resolvedApiDays = useMemo(
    () => resolveDaySelectionsForApi(selectedDays),
    [dayAnchorKey, selectedDays]
  );

  useEffect(() => {
    if (hasLetterboxdUsername || !watchlistOnly) return;
    setWatchlistOnly(false);
  }, [hasLetterboxdUsername, setWatchlistOnly, watchlistOnly]);

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
    timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
    selectedStatuses: (includeInterested ? ['GOING', 'INTERESTED'] : ['GOING']) as GoingStatus[],
    watchlistOnly: effectiveAppliedWatchlistOnly ? true : undefined,
  }), [
    effectiveAppliedWatchlistOnly,
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
    setGroupByMovie(false);
    setSelectedDays([]);
    setSelectedTimeRanges([]);
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

  const moviesContent = groupByMovie ? (
    <SectionList
      style={styles.flex}
      sections={movieSections}
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
          onLongPress={(st) => router.push(`/movie/${st.movie.id}`)}
        />
      )}
      contentContainerStyle={styles.movieSectionContent}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        isLoading || isFetching ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.tint} />
          </View>
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
        ) : null
      }
      onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
      onEndReachedThreshold={2}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
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
              groupByMovie={groupByMovie}
              setGroupByMovie={setGroupByMovie}
              watchlistOnly={effectiveWatchlistOnly}
              setWatchlistOnly={setWatchlistOnly}
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
        canUseWatchlistFilter={hasLetterboxdUsername}
        selectedShowtimeFilter="all"
        setSelectedShowtimeFilter={() => {}}
        showStatusFilter={false}
        showCinemas={false}
        showRuntime={false}
        selectedDays={selectedDays}
        setSelectedDays={setSelectedDays}
        selectedTimeRanges={selectedTimeRanges}
        setSelectedTimeRanges={setSelectedTimeRanges}
        selectedRuntimeRanges={[]}
        setSelectedRuntimeRanges={() => {}}
        resultCount={groupByMovie ? movieSections.length : showtimes.length}
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
      paddingBottom: 16,
    },
    centerContainer: { paddingVertical: 40, alignItems: 'center' },
    emptyText: { fontSize: 16, color: colors.textSecondary },
    footerLoader: { paddingVertical: 20, alignItems: 'center' },
  });
