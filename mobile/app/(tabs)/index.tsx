/**
 * Expo Router screen/module for (tabs) / index. It controls navigation and screen-level state for this route.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, type View } from 'react-native';
import { ThemedRefreshControl } from '@/components/themed-refresh-control';
import { DateTime } from 'luxon';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useFetchMainPageShowtimes } from 'shared/hooks/useFetchMainPageShowtimes';
import { useFetchMovies, type MovieFilters } from 'shared/hooks/useFetchMovies';
import type { SearchField } from 'shared/client';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import useAuth from 'shared/hooks/useAuth';
import TopSafeAreaView from '@/components/layout/TopSafeAreaView';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import FiltersRow from '@/components/filters/FiltersRow';
import { useFiltersModal } from '@/components/filters/FiltersModalProvider';
import ActiveFilterChips from '@/components/filters/ActiveFilterChips';
import FeatureTipsHost from '@/components/tips/FeatureTipsHost';
import CinevilleCardButton from '@/components/cineville/CinevilleCardButton';
import IntroFiltersSpotlight from '@/components/intro/IntroFiltersSpotlight';
import { ShowtimesListContent } from '@/components/showtimes/ShowtimesScreen';
import LoadMoreFooter from '@/components/ui/LoadMoreFooter';
import { SkeletonRows } from '@/components/ui/SkeletonRows';
import MovieCard from '@/components/movies/MovieCard';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import { getRuntimeBoundsFromSelections } from '@/components/filters/runtime-range-utils';
import { applyDisplayPreset, type DisplayPreset } from '@/components/filters/saved-presets';
import {
  getSelectedStatusesFromShowtimeFilter,
} from '@/components/filters/shared-tab-filters';
import { tabletCappedContentStyle } from '@/constants/tablet-layout';
import { useThemeColors } from '@/hooks/use-theme-color';
import { useIsSignedIn } from '@/utils/auth-session';
import { useIsAnyBlockingOverlayOpen } from '@/utils/blocking-overlays';
import { useIntroPhase } from '@/utils/intro';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';
import { useSingleFireNavigation } from '@/hooks/useSingleFireNavigation';
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from '@/utils/reset-infinite-query';

// One request per pause in typing, not one per keystroke — five requests for
// "alkmaar" racing each other otherwise, and whichever lands last (not
// necessarily the one for the finished word) is what the list is left
// showing. See useDebouncedValue.
const SEARCH_DEBOUNCE_MS = 280;

export default function MainShowtimesScreen() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const goToMovieFromCard = useSingleFireNavigation((movieId: number) =>
    router.push({
      pathname: '/movie/[id]',
      params: { id: String(movieId), inheritFilters: '1' },
    })
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('title');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);
  // Clearing the field drops the results immediately — waiting out the
  // debounce to remove what the user just deleted would feel broken.
  const effectiveSearchQuery = searchQuery.trim().length > 0 ? debouncedSearchQuery : '';
  const [isFilterTransitionLoading, setIsFilterTransitionLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { openFiltersModal } = useFiltersModal();
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());
  const isFocused = useIsFocused();
  // The intro's last step highlights this screen's Filters button in place.
  const filtersButtonRef = useRef<View>(null);
  const introPhase = useIntroPhase();
  const isAnyBlockingOverlayOpen = useIsAnyBlockingOverlayOpen();

  const {
    selectedShowtimeFilter,
    appliedShowtimeFilter,
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
    selectedLanguages,
    setSelectedLanguages,
    watchlistExclude,
    setWatchlistExclude,
    watchedOnly,
    setWatchedOnly,
  } = useSharedTabFilters();

  const { user } = useAuth();
  const isSignedIn = useIsSignedIn();
  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());
  const effectiveWatchlistOnly = hasLetterboxdUsername ? watchlistOnly : false;
  const effectiveAppliedWatchlistOnly = hasLetterboxdUsername ? appliedWatchlistOnly : false;
  const effectiveHideWatched = hasLetterboxdUsername ? hideWatched : false;
  const effectiveAppliedHideWatched = hasLetterboxdUsername ? appliedHideWatched : false;
  const effectiveWatchlistExclude = hasLetterboxdUsername ? watchlistExclude : false;
  const effectiveWatchedOnly = hasLetterboxdUsername ? watchedOnly : false;

  // "Clear all" restores the account's saved cinemas. A guest has none to
  // restore to — the session selection *is* what they saved — so their cinema
  // choice is deliberately left alone by it.
  const { data: preferredCinemaIds } = useFetchSelectedCinemas({ enabled: isSignedIn });

  const dayAnchorKey =
    DateTime.now().setZone('Europe/Amsterdam').startOf('day').toISODate() ?? '';
  const resolvedApiDays = useMemo(
    () =>
      resolveDaySelectionsForApi(selectedDays, {
        startDate: DateTime.fromISO(dayAnchorKey, { zone: "Europe/Amsterdam" }),
      }),
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

  useEffect(() => {
    if (hasLetterboxdUsername || !hideWatched) return;
    setHideWatched(false);
  }, [hasLetterboxdUsername, setHideWatched, hideWatched]);

  // A cinema-name search already narrows results to matching cinemas, so a
  // cinema selection on top of it would only ever narrow further — the pill
  // reads as "All cinemas" and the query drops the filter to match, while
  // sessionCinemaIds itself is left alone (see CinemaFilterChip's `disabled`).
  const isSearchingByCinema = searchField === "cinema" && effectiveSearchQuery.trim().length > 0;

  // ─── Showtimes query ────────────────────────────────────────────────────────
  const showtimesFilters = useMemo(() => ({
    query: effectiveSearchQuery || undefined,
    searchField,
    selectedCinemaIds: isSearchingByCinema ? undefined : sessionCinemaIds,
    days: resolvedApiDays,
    timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
    runtimeMin: runtimeBounds.runtimeMin,
    runtimeMax: runtimeBounds.runtimeMax,
    selectedStatuses: getSelectedStatusesFromShowtimeFilter(appliedShowtimeFilter),
    watchlistOnly: effectiveAppliedWatchlistOnly ? true : undefined,
    watchlistExclude: effectiveWatchlistExclude ? true : undefined,
    hideWatched: effectiveAppliedHideWatched ? true : undefined,
    watchedOnly: effectiveWatchedOnly ? true : undefined,
    selectedListIds: selectedListIds.length > 0 ? selectedListIds : undefined,
    excludeListIds: excludeListIds.length > 0 ? excludeListIds : undefined,
    selectedLanguages: selectedLanguages.length > 0 ? selectedLanguages : undefined,
  }), [
    effectiveSearchQuery, searchField, appliedShowtimeFilter, resolvedApiDays, selectedTimeRanges,
    runtimeBounds.runtimeMin, runtimeBounds.runtimeMax, sessionCinemaIds, isSearchingByCinema,
    effectiveAppliedWatchlistOnly, effectiveAppliedHideWatched, selectedListIds, excludeListIds,
    effectiveWatchlistExclude, effectiveWatchedOnly, selectedLanguages,
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
      query: effectiveSearchQuery,
      searchField,
      watchlistOnly: effectiveAppliedWatchlistOnly ? true : undefined,
      hideWatched: effectiveAppliedHideWatched ? true : undefined,
      days: resolvedApiDays,
      timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
      runtimeMin: runtimeBounds.runtimeMin,
      runtimeMax: runtimeBounds.runtimeMax,
      selectedCinemaIds: isSearchingByCinema ? undefined : sessionCinemaIds,
      selectedStatuses: getSelectedStatusesFromShowtimeFilter(appliedShowtimeFilter),
      watchlistExclude: effectiveWatchlistExclude ? true : undefined,
      watchedOnly: effectiveWatchedOnly ? true : undefined,
      selectedListIds: selectedListIds.length > 0 ? selectedListIds : undefined,
      excludeListIds: excludeListIds.length > 0 ? excludeListIds : undefined,
      selectedLanguages: selectedLanguages.length > 0 ? selectedLanguages : undefined,
    }),
    [
      effectiveSearchQuery, searchField, effectiveAppliedWatchlistOnly, effectiveAppliedHideWatched, resolvedApiDays, selectedTimeRanges,
      runtimeBounds.runtimeMin, runtimeBounds.runtimeMax, sessionCinemaIds, isSearchingByCinema, appliedShowtimeFilter,
      selectedListIds, excludeListIds, effectiveWatchlistExclude, effectiveWatchedOnly, selectedLanguages,
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
    effectiveWatchlistOnly !== effectiveAppliedWatchlistOnly ||
    effectiveHideWatched !== effectiveAppliedHideWatched;

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
      // One snapshot drives both the showtimes and movies queries, so which
      // mode is on screen no longer changes what a refresh has to do.
      await refreshInfiniteQueryWithFreshSnapshot({ setSnapshotTime });
    } finally {
      setRefreshing(false);
    }
  };

  const handleApplyPreset = (preset: DisplayPreset) => {
    setIsFilterTransitionLoading(true);
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
      setGroupByMovie,
      setSelectedLanguages,
      setSessionCinemaIds,
      selectedListIds,
      excludeListIds,
      setSelectedListIds,
      setExcludeListIds,
    });
  };

  const handleOpenFiltersModal = () =>
    openFiltersModal({ showGroupByMovie: true, showPresets: true });

  const filtersRowProps = {
    onOpenModal: handleOpenFiltersModal,
    onApplyPreset: handleApplyPreset,
    filtersButtonRef,
  };

  // The last intro step waits for this screen to actually have something on it:
  // highlighting a filter button above an empty list would explain nothing. It
  // also waits for a clear screen — `isFocused` covers a pushed page, and the
  // overlay register covers the sheets that open over this one, which are
  // windows rather than routes.
  const hasLoadedFeed = groupByMovie
    ? !moviesLoading && movies.length > 0
    : !showtimesLoading && !isFilterTransitionLoading && showtimes.length > 0;
  const isShowingIntroFiltersSpotlight =
    introPhase === 'filters-spotlight' &&
    isFocused &&
    !isAnyBlockingOverlayOpen &&
    hasLoadedFeed;

  const activeChipsProps = {
    groupByMovie,
    setGroupByMovie,
    watchlistOnly: effectiveWatchlistOnly,
    setWatchlistOnly: (v: boolean) => { setIsFilterTransitionLoading(true); setWatchlistOnly(v); },
    watchlistExclude: effectiveWatchlistExclude,
    setWatchlistExclude: (v: boolean) => { setIsFilterTransitionLoading(true); setWatchlistExclude(v); },
    hideWatched: effectiveHideWatched,
    setHideWatched: (v: boolean) => { setIsFilterTransitionLoading(true); setHideWatched(v); },
    watchedOnly: effectiveWatchedOnly,
    setWatchedOnly: (v: boolean) => { setIsFilterTransitionLoading(true); setWatchedOnly(v); },
    canUseWatchlistFilter: hasLetterboxdUsername,
    selectedShowtimeFilter,
    setSelectedShowtimeFilter: (v: typeof selectedShowtimeFilter) => {
      setIsFilterTransitionLoading(true);
      setSelectedShowtimeFilter(v);
    },
    showStatusFilter: isSignedIn,
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
    selectedLanguages,
    setSelectedLanguages,
    onOpenFilters: () => openFiltersModal({ showGroupByMovie: true, showPresets: true }),
    cinemaFilterDisabled: isSearchingByCinema,
    onClearAll: () => {
      setIsFilterTransitionLoading(true);
      setSelectedShowtimeFilter('all');
      setWatchlistOnly(false);
      setWatchlistExclude(false);
      setHideWatched(false);
      setWatchedOnly(false);
      setGroupByMovie(false);
      setSelectedDays([]);
      setSelectedTimeRanges([]);
      setSelectedRuntimeRanges([]);
      setSelectedListIds([]);
      setExcludeListIds([]);
      setSelectedLanguages([]);
      if (preferredCinemaIds) setSessionCinemaIds(preferredCinemaIds);
    },
  };

  const renderMoviesEmpty = () => {
    if (moviesLoading || moviesFetching || refreshing) {
      return <SkeletonRows height={150} />;
    }
    return (
      <ThemedView style={styles.centerContainer}>
        <ThemedText style={styles.emptyText}>No movies found</ThemedText>
      </ThemedView>
    );
  };

  // Clear the list while refreshing so the pull-to-refresh visibly reloads,
  // even when the refetched data is unchanged.
  const visibleMovies = refreshing ? [] : movies;

  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar />
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        searchField={searchField}
        onChangeSearchField={setSearchField}
        clearOnAndroidBack
      />
      <FiltersRow {...filtersRowProps} />
      <ActiveFilterChips {...activeChipsProps} />
      {groupByMovie ? (
        <FlatList
          data={visibleMovies}
          renderItem={({ item }) => (
            <MovieCard
              movie={item}
              onPress={(movie) => goToMovieFromCard(movie.id)}
            />
          )}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.movieFeed}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderMoviesEmpty}
          ListFooterComponent={<LoadMoreFooter loading={moviesFetchingNextPage} />}
          onEndReached={() => {
            if (moviesHasNextPage && !moviesFetchingNextPage) moviesFetchNextPage();
          }}
          onEndReachedThreshold={2}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
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
          openModalOptions={{ inheritFilters: true }}
          inheritFiltersOnMovieNav
        />
      )}
      {/* Floats over whichever feed is on screen, so it goes after both. */}
      <CinevilleCardButton surface="showtimes" />
      {/* Renders nothing inline: the tip, if any, is a modal over the screen. */}
      <FeatureTipsHost />
      {isShowingIntroFiltersSpotlight ? (
        <IntroFiltersSpotlight
          targetRef={filtersButtonRef}
          onOpenFilters={handleOpenFiltersModal}
        />
      ) : null}
    </TopSafeAreaView>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    movieFeed: { ...tabletCappedContentStyle, padding: 16 },
    centerContainer: { paddingVertical: 40, alignItems: 'center' },
    emptyText: { fontSize: 16, color: colors.textSecondary },
  });
