/**
 * Expo Router screen/module for (tabs) / index. It controls navigation and screen-level state for this route.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { ThemedRefreshControl } from '@/components/themed-refresh-control';
import { DateTime } from 'luxon';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import TabScreenSkeleton from '@/components/layout/TabScreenSkeleton';
import { tabContentHoldMs } from '@/components/tab-bar';
import { useDeferredMount } from '@/utils/use-deferred-mount';
import { useRouter } from 'expo-router';
import { useFetchMainPageShowtimes } from 'shared/hooks/useFetchMainPageShowtimes';
import { useFetchMovies, type MovieFilters } from 'shared/hooks/useFetchMovies';
import type { SearchField } from 'shared/client';
import type { MovieSummaryPublic } from 'shared';
import { useFetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import useAuth from 'shared/hooks/useAuth';
import TopSafeAreaView from '@/components/layout/TopSafeAreaView';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import PresetsRow from '@/components/filters/PresetsRow';
import { FILTER_ROW_SETTLE_MS } from '@/components/filters/filter-change-animation';
import FiltersButton from '@/components/filters/FiltersButton';
import SearchFieldFallback from '@/components/inputs/SearchFieldFallback';
import { useFiltersModal } from '@/components/filters/FiltersModalProvider';
import ActiveFilterChips from '@/components/filters/ActiveFilterChips';
import FeatureTipsHost from '@/components/tips/FeatureTipsHost';
import CinevilleCardButton from '@/components/cineville/CinevilleCardButton';
import IntroFiltersSpotlight from '@/components/intro/IntroFiltersSpotlight';
import { ShowtimesListContent } from '@/components/showtimes/ShowtimesScreen';
import LoadMoreFooter from '@/components/ui/LoadMoreFooter';
import ListLoadingLogo from '@/components/layout/ListLoadingLogo';
import { useDelayedTrue } from '@/hooks/useDelayedTrue';
import { LOADING_LOGO_DELAY_MS, LOADING_LOGO_COOLDOWN_MS } from '@/constants/loading-logo';
import { FeedItemEntrance } from '@/components/ui/FeedItemEntrance';
import MovieCard from '@/components/movies/MovieCard';
import {
  byIdKeyExtractor,
  MOVIES_FIRST_PAGE_LIMIT,
  SHOWTIMES_FIRST_PAGE_LIMIT,
  useScrollTriggeredLoadMore,
} from '@/components/feeds/feed-paging';
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
/**
 * When the other tabs are built, and how far apart.
 *
 * A tab is mounted the first time you press it, in the same commit that starts
 * the slide — so the first press of each tab spends the whole animation
 * building a screen, and no animation outruns that: the mount is UI-thread
 * work, which is the one thing a native-driven tween cannot ignore.
 *
 * So they are built here instead, one at a time, once this screen has had a
 * while to settle. It costs the same work; it just spends it in dead time
 * rather than in front of the user. Pressing a tab before its turn comes round
 * simply mounts it the old way.
 */
const TAB_PRELOAD_START_MS = 2500;
const TAB_PRELOAD_GAP_MS = 600;
/** Every tab in the bar except this one. `movies` has no button. */
const PRELOADED_TABS = ['activity', 'friends', 'settings'] as const;

/**
 * Hoisted so the feed is handed the same object every render: it reaches
 * `ShowtimeCard` through the list's `renderItem`, and a new object there
 * re-renders every visible card. See `ShowtimeCard`'s memo.
 */
const SHOWTIME_MODAL_OPTIONS = { inheritFilters: true } as const;

const SEARCH_DEBOUNCE_MS = 280;

function MainShowtimesScreen() {
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
  /**
   * The earliest the feed may fill itself back in. Only a preset apply sets it:
   * that is the one filter change with a whole choreography playing above the
   * feed, and rebuilding the list underneath is enough UI-thread work to stall
   * it half-way through. Everything else clears on the next frame as before.
   *
   * State rather than a ref so that a second preset tapped during the first
   * one's hold re-arms the wait instead of inheriting the first one's deadline.
   */
  const [feedHoldUntil, setFeedHoldUntil] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const { openFiltersModal } = useFiltersModal();
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());
  const isFocused = useIsFocused();
  // Typed by hand: `preload` belongs to the tab navigator this screen sits in,
  // and the generic `useNavigation()` result cannot know which navigator that
  // is without the app declaring its whole route map.
  const tabNavigation = useNavigation<{ preload: (name: string) => void }>();

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    PRELOADED_TABS.forEach((name, index) => {
      timers.push(
        setTimeout(
          () => tabNavigation.preload(name),
          TAB_PRELOAD_START_MS + index * TAB_PRELOAD_GAP_MS
        )
      );
    });
    return () => timers.forEach(clearTimeout);
  }, [tabNavigation]);
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
    appliedGroupByMovie,
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
    firstPageLimit: SHOWTIMES_FIRST_PAGE_LIMIT,
    snapshotTime,
    filters: showtimesFilters,
    enabled: isFocused && !appliedGroupByMovie,
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
    firstPageLimit: MOVIES_FIRST_PAGE_LIMIT,
    snapshotTime,
    filters: movieFilters,
    enabled: isFocused && appliedGroupByMovie,
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

  // One identity for the life of the list: a new `renderItem` re-renders every
  // cell, which would undo `MovieCard`'s memo.
  const openMovie = useCallback(
    (movie: { id: number }) => goToMovieFromCard(movie.id),
    [goToMovieFromCard]
  );
  const renderMovie = useCallback(
    ({ item, index }: { item: MovieSummaryPublic; index: number }) => (
      <FeedItemEntrance index={index}>
        <MovieCard movie={item} onPress={openMovie} />
      </FeedItemEntrance>
    ),
    [openMovie]
  );

  const loadMoreMovies = useScrollTriggeredLoadMore(() => {
    if (moviesHasNextPage && !moviesFetchingNextPage) moviesFetchNextPage();
  });

  const isAppliedFilterTransitionPending =
    selectedShowtimeFilter !== appliedShowtimeFilter ||
    effectiveWatchlistOnly !== effectiveAppliedWatchlistOnly ||
    effectiveHideWatched !== effectiveAppliedHideWatched ||
    groupByMovie !== appliedGroupByMovie;

  const showtimes = useMemo(() => showtimesData?.pages.flat() ?? [], [showtimesData]);
  const movies = useMemo(() => moviesData?.pages.flat() ?? [], [moviesData]);
  const visibleShowtimes = isFilterTransitionLoading ? [] : showtimes;

  useEffect(() => {
    if (!isFilterTransitionLoading) return;
    if (isAppliedFilterTransitionPending) return;
    // A timer rather than a frame when the filter row is still playing. Being
    // late here is harmless — the feed stays empty a moment longer — which is
    // the only kind of thing a JS timer may be trusted with while an apply has
    // the thread busy.
    const wait = feedHoldUntil - Date.now();
    if (wait > 0) {
      const timer = setTimeout(() => setIsFilterTransitionLoading(false), wait);
      return () => clearTimeout(timer);
    }
    const frame = requestAnimationFrame(() => setIsFilterTransitionLoading(false));
    return () => cancelAnimationFrame(frame);
  }, [feedHoldUntil, isAppliedFilterTransitionPending, isFilterTransitionLoading]);

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
    setFeedHoldUntil(Date.now() + FILTER_ROW_SETTLE_MS);
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

  // The last intro step waits for this screen to actually have something on it:
  // highlighting a filter button above an empty list would explain nothing. It
  // also waits for a clear screen — `isFocused` covers a pushed page, and the
  // overlay register covers the sheets that open over this one, which are
  // windows rather than routes.
  const hasLoadedFeed = appliedGroupByMovie
    ? !moviesLoading && movies.length > 0
    : !showtimesLoading && !isFilterTransitionLoading && showtimes.length > 0;
  const isShowingIntroFiltersSpotlight =
    introPhase === 'filters-spotlight' &&
    isFocused &&
    !isAnyBlockingOverlayOpen &&
    hasLoadedFeed;

  const activeChipsProps = {
    groupByMovie,
    setGroupByMovie: (v: boolean) => { setIsFilterTransitionLoading(true); setGroupByMovie(v); },
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

  // Same notice under either feed's empty state: the search field is shared by
  // both, and so is the reason an unexpected empty result turns up.
  const searchFieldFallback = (
    <SearchFieldFallback
      searchField={searchField}
      query={effectiveSearchQuery}
      onSearchByTitle={() => setSearchField('title')}
    />
  );

  // Pull-to-refresh no longer clears the list: RefreshControl's own spinner
  // at the top already says a reload is happening, so the old cards just
  // stay up and get swapped for the fresh ones once they land. A filter
  // change still clears it: switching mode mounts a whole feed from nothing,
  // and mounting it full of cards is the one piece of work heavy enough to
  // stall the filter row's animation on its way past.
  const visibleMovies = isFilterTransitionLoading ? [] : movies;

  // `moviesLoading`/`isFilterTransitionLoading` mean there's nothing cached
  // yet (no data, or a whole feed being mounted from nothing) — nothing to
  // lose by showing the panel immediately, and a delay here is exactly the
  // "blank screen for too long" a genuine wait like that doesn't need.
  // `moviesFetching`-only (data already empty, but a background refetch is
  // running) is the case that can resolve from cache almost instantly, so
  // that one keeps the anti-flash delay and cooldown. `!refreshing` on both:
  // RefreshControl's own spinner already covers a pull-to-refresh, so the
  // panel has nothing to do for one even on an already-empty list.
  const isMoviesFirstLoadEmpty =
    (moviesLoading || isFilterTransitionLoading) && !refreshing && movies.length === 0;
  const isMoviesBackgroundFetchEmpty =
    moviesFetching &&
    !moviesLoading &&
    !isFilterTransitionLoading &&
    !refreshing &&
    movies.length === 0;
  const showMoviesBackgroundFetchLoadingLogo = useDelayedTrue(
    isMoviesBackgroundFetchEmpty,
    LOADING_LOGO_DELAY_MS,
    LOADING_LOGO_COOLDOWN_MS
  );
  const showMoviesLoadingLogo = isMoviesFirstLoadEmpty || showMoviesBackgroundFetchLoadingLogo;
  const isMoviesEmptyLoading = isMoviesFirstLoadEmpty || isMoviesBackgroundFetchEmpty;

  const renderMoviesEmpty = () => {
    // The loading panel is a fixed overlay (below), not part of the list's
    // own content, so there's nothing to render here while it's up.
    if (isMoviesEmptyLoading) return null;
    return (
      <ThemedView style={styles.centerContainer}>
        <ThemedText style={styles.emptyText}>No movies found</ThemedText>
        {searchFieldFallback}
      </ThemedView>
    );
  };

  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar />
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        searchField={searchField}
        onChangeSearchField={setSearchField}
        clearOnAndroidBack
        leftSlot={
          <FiltersButton onPress={handleOpenFiltersModal} buttonRef={filtersButtonRef} />
        }
      />
      <PresetsRow onApplyPreset={handleApplyPreset} />
      <ActiveFilterChips {...activeChipsProps} />
      {appliedGroupByMovie ? (
        <View style={styles.listWrapper}>
          <FlatList
            data={visibleMovies}
            renderItem={renderMovie}
            keyExtractor={byIdKeyExtractor}
            contentContainerStyle={styles.movieFeed}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={renderMoviesEmpty}
            ListFooterComponent={<LoadMoreFooter loading={moviesFetchingNextPage} />}
            onScrollBeginDrag={loadMoreMovies.onScrollBeginDrag}
            onEndReached={loadMoreMovies.onEndReached}
            onEndReachedThreshold={2}
            refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          />
          {/* An overlay, not the list's ListEmptyComponent: that content
              scrolls and shifts with RefreshControl's pull, which read as the
              logo drifting down the screen. Sitting outside the FlatList
              keeps it fixed in place and (via pointerEvents="none") never
              intercepts the pull-to-refresh gesture underneath it. */}
          {showMoviesLoadingLogo ? (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <ListLoadingLogo />
            </View>
          ) : null}
        </View>
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
          emptyExtra={searchFieldFallback}
          openModalOptions={SHOWTIME_MODAL_OPTIONS}
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
    listWrapper: { flex: 1 },
    loadingOverlay: { ...StyleSheet.absoluteFillObject },
    movieFeed: { ...tabletCappedContentStyle, padding: 16 },
    centerContainer: { paddingVertical: 40, alignItems: 'center' },
    emptyText: { fontSize: 16, color: colors.textSecondary },
  });

/**
 * The shell in front of the screen above.
 *
 * A tab is built the first time it is opened, and until it is, the tab you
 * pressed away from stays on screen — which reads as the press being ignored.
 * The gate is a component of its own so that every hook the screen owns lives
 * *behind* it: an early return inside one component would only defer the
 * render, not the queries and subscriptions that set it up.
 *
 * The wait is whatever {@link tabContentHoldMs} still owes the tab bar's press
 * flash, so the mount takes the UI thread only once that movement is over
 * rather than stalling it half-way. Once a tab has been built it is never
 * gated again.
 */
export default function MainShowtimesScreenTab() {
  const ready = useDeferredMount('tab:index', tabContentHoldMs);
  if (!ready) return <TabScreenSkeleton rowHeight={112} />;
  return <MainShowtimesScreen />;
}
