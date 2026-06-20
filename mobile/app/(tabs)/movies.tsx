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
import TopSafeAreaView from '@/components/layout/TopSafeAreaView';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useFetchMovies, type MovieFilters } from 'shared/hooks/useFetchMovies';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import useAuth from 'shared/hooks/useAuth';
import { DateTime } from 'luxon';
import { useQueryClient } from '@tanstack/react-query';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import FiltersRow from '@/components/filters/FiltersRow';
import { useFiltersModal } from '@/components/filters/FiltersModalProvider';
import ActiveFilterChips from '@/components/filters/ActiveFilterChips';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import { applyDisplayPreset, type DisplayPreset } from '@/components/filters/saved-presets';
import { getRuntimeBoundsFromSelections } from '@/components/filters/runtime-range-utils';
import {
  getSelectedStatusesFromShowtimeFilter,
  toSharedTabShowtimeFilter,
} from '@/components/filters/shared-tab-filters';
import { useThemeColors } from '@/hooks/use-theme-color';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';
import MovieCard from '@/components/movies/MovieCard';
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
    setSelectedListIds,
    excludeListIds,
    setExcludeListIds,
    watchlistExclude,
    setWatchlistExclude,
    watchedOnly,
    setWatchedOnly,
  } = useSharedTabFilters();

  const { user } = useAuth();
  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());
  const effectiveWatchlistOnly = hasLetterboxdUsername ? watchlistOnly : false;
  const effectiveAppliedWatchlistOnly = hasLetterboxdUsername ? appliedWatchlistOnly : false;
  const effectiveHideWatched = hasLetterboxdUsername ? hideWatched : false;
  const effectiveAppliedHideWatched = hasLetterboxdUsername ? appliedHideWatched : false;
  const effectiveWatchlistExclude = hasLetterboxdUsername ? watchlistExclude : false;
  const effectiveWatchedOnly = hasLetterboxdUsername ? watchedOnly : false;

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

  useEffect(() => {
    if (hasLetterboxdUsername || !watchlistOnly) return;
    setWatchlistOnly(false);
  }, [hasLetterboxdUsername, setWatchlistOnly, watchlistOnly]);

  useEffect(() => {
    if (hasLetterboxdUsername || !hideWatched) return;
    setHideWatched(false);
  }, [hasLetterboxdUsername, setHideWatched, hideWatched]);

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
      selectedStatuses: getSelectedStatusesFromShowtimeFilter(selectedShowtimeFilter),
      watchlistExclude: effectiveWatchlistExclude ? true : undefined,
      watchedOnly: effectiveWatchedOnly ? true : undefined,
      selectedListIds: selectedListIds.length > 0 ? selectedListIds : undefined,
      excludeListIds: excludeListIds.length > 0 ? excludeListIds : undefined,
    }),
    [
      searchQuery,
      effectiveAppliedWatchlistOnly,
      effectiveAppliedHideWatched,
      effectiveWatchlistExclude,
      effectiveWatchedOnly,
      resolvedApiDays,
      selectedTimeRanges,
      selectedListIds,
      excludeListIds,
      runtimeBounds.runtimeMin,
      runtimeBounds.runtimeMax,
      sessionCinemaIds,
      selectedShowtimeFilter,
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

  const handleApplyPreset = (preset: DisplayPreset) => {
    applyDisplayPreset(preset, {
      hasLetterboxdUsername,
      setSelectedShowtimeFilter,
      setWatchlistOnly,
      setWatchlistExclude,
      setHideWatched,
      setWatchedOnly,
      setSelectedDays,
      setSelectedTimeRanges,
      setSelectedRuntimeRanges,
      setSessionCinemaIds,
      setGroupByMovie,
      selectedListIds,
      excludeListIds,
      setSelectedListIds,
      setExcludeListIds,
    });
  };


  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar />
      <SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder="Search movies" />
      <FiltersRow
        onOpenModal={() => openFiltersModal({ showGroupByMovie: false })}
        onApplyPreset={handleApplyPreset}
      />
      <ActiveFilterChips
        groupByMovie={groupByMovie}
        setGroupByMovie={setGroupByMovie}
        watchlistOnly={effectiveWatchlistOnly}
        setWatchlistOnly={setWatchlistOnly}
        hideWatched={effectiveHideWatched}
        setHideWatched={setHideWatched}
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
        onOpenFilters={() => openFiltersModal({ showGroupByMovie: false })}
        onClearAll={() => {
          setSelectedShowtimeFilter(toSharedTabShowtimeFilter('all'));
          setWatchlistOnly(false);
          setHideWatched(false);
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
