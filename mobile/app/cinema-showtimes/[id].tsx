/**
 * Expo Router screen/module for cinema-showtimes / [id]. It controls navigation and screen-level state for this route.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { FlatList, Linking, StyleSheet, View } from "react-native";
import { ThemedRefreshControl } from "@/components/themed-refresh-control";
import { DateTime } from "luxon";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useFetchMainPageShowtimes } from "shared/hooks/useFetchMainPageShowtimes";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchMovies } from "shared/hooks/useFetchMovies";
import type { SearchField } from "shared/client";
import useAuth from "shared/hooks/useAuth";

import ShowtimesScreen, {
  ShowtimesScreenSkeleton,
} from "@/components/showtimes/ShowtimesScreen";
import { useIsSignedIn } from "@/utils/auth-session";
import { useDeferredMount } from "@/utils/use-deferred-mount";
import FiltersButton from "@/components/filters/FiltersButton";
import FiltersModal from "@/components/filters/FiltersModal";
import ActiveFilterChips from "@/components/filters/ActiveFilterChips";
import SearchFieldFallback from "@/components/inputs/SearchFieldFallback";
import MovieCard from "@/components/movies/MovieCard";
import type { MovieSummaryPublic } from "shared";
import {
  byIdKeyExtractor,
  MOVIES_FIRST_PAGE_LIMIT,
  SHOWTIMES_FIRST_PAGE_LIMIT,
  useScrollTriggeredLoadMore,
} from "@/components/feeds/feed-paging";
import ListLoadingLogo from "@/components/layout/ListLoadingLogo";
import { useDelayedTrue } from "@/hooks/useDelayedTrue";
import { LOADING_LOGO_DELAY_MS, LOADING_LOGO_COOLDOWN_MS } from "@/constants/loading-logo";
import { FeedItemEntrance } from "@/components/ui/FeedItemEntrance";
import LoadMoreFooter from "@/components/ui/LoadMoreFooter";
import { ThemedText } from "@/components/themed-text";
import { resolveDaySelectionsForApi } from "@/components/filters/day-filter-utils";
import { getRuntimeBoundsFromSelections } from "@/components/filters/runtime-range-utils";
import {
  getSelectedStatusesFromShowtimeFilter,
} from "@/components/filters/shared-tab-filters";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useSingleFireNavigation } from "@/hooks/useSingleFireNavigation";
import { useThemeColors } from "@/hooks/use-theme-color";
import { buildSnapshotTime, useSnapshotRefresh } from "@/utils/reset-infinite-query";
import { useSharedTabFilters } from "@/hooks/useSharedTabFilters";
import { getCinemaColorPalette } from "@/utils/cinema-color";

// One request per pause in typing, not one per keystroke — see
// useDebouncedValue and (tabs)/index.tsx's identical guard.
const SEARCH_DEBOUNCE_MS = 280;

// Searching by cinema inside a single cinema's page could only ever return
// that same cinema's showtimes or nothing at all, so the option is dropped.
const HIDDEN_SEARCH_FIELDS: readonly SearchField[] = ["cinema"];

const EMPTY_DAYS: string[] = [];
const EMPTY_TIME_RANGES: string[] = [];
const EMPTY_RUNTIME_RANGES: string[] = [];

const getRouteParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/**
 * Shared by the deferred-mount skeleton and the real content below so both
 * phases render the cinema's accent color / maps link / website link on
 * their very first frame — computing this only once data has loaded would
 * flash from the default header colors into the cinema's own.
 */
const buildCinemaHeaderProps = ({
  cinemaName,
  cityName,
  badgeBgColorKey,
  url,
  colors,
}: {
  cinemaName: string;
  cityName: string;
  badgeBgColorKey: string;
  url: string;
  colors: ReturnType<typeof useThemeColors>;
}) => {
  const cinemaPalette = badgeBgColorKey
    ? getCinemaColorPalette({ name: cinemaName || "Cinema", badge_bg_color: badgeBgColorKey }, colors)
    : undefined;
  const topBarAccentColor = cinemaPalette
    ? { background: cinemaPalette.primary, text: cinemaPalette.secondary }
    : undefined;
  const mapsQuery = [cinemaName, cityName].filter(Boolean).join(", ");
  const handleOpenLocation = mapsQuery
    ? () => {
        void Linking.openURL(
          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
        );
      }
    : undefined;
  return { topBarAccentColor, handleOpenLocation, topBarLinkUrl: url || undefined };
};

/**
 * The search field and the Filters button frame this screen rather than being
 * part of what it loads, so they live above the deferred-mount split and are
 * live on the first frame. Their state is owned here too, so a query typed (or
 * a filter sheet opened) before the content mounts is still there afterwards.
 *
 * The row itself is the main feed's: the Filters button sits inside the search
 * row rather than on a row of its own, and the field carries the same
 * Title/Director/Actor/Friends selector — minus Cinema, see
 * {@link HIDDEN_SEARCH_FIELDS}.
 */
export default function CinemaShowtimesScreen() {
  const { name, city, badgeBgColor, url } = useLocalSearchParams<{
    name?: string | string[];
    city?: string | string[];
    badgeBgColor?: string | string[];
    url?: string | string[];
  }>();
  const cinemaKey = `cinema:${Array.isArray(name) ? name[0] : name}:${Array.isArray(city) ? city[0] : city}`;
  const ready = useDeferredMount(cinemaKey);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchField, setSearchField] = useState<SearchField>("title");
  const [filtersModalVisible, setFiltersModalVisible] = useState(false);
  const colors = useThemeColors();

  const filtersButton = <FiltersButton onPress={() => setFiltersModalVisible(true)} />;

  if (!ready) {
    const routeCinemaName = getRouteParam(name)?.trim() ?? "";
    const routeCityName = getRouteParam(city)?.trim() ?? "";
    const routeBadgeBgColor = getRouteParam(badgeBgColor)?.trim() ?? "";
    const routeUrl = getRouteParam(url)?.trim() ?? "";
    const { topBarAccentColor, handleOpenLocation, topBarLinkUrl } = buildCinemaHeaderProps({
      cinemaName: routeCinemaName,
      cityName: routeCityName,
      badgeBgColorKey: routeBadgeBgColor,
      url: routeUrl,
      colors,
    });
    return (
      <ShowtimesScreenSkeleton
        topBarTitle={routeCinemaName || "Cinema"}
        topBarTitleSuffix={routeCityName || undefined}
        topBarShowBackButton
        topBarAccentColor={topBarAccentColor}
        topBarOnTitleSuffixPress={handleOpenLocation}
        topBarLinkUrl={topBarLinkUrl}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchField={searchField}
        onChangeSearchField={setSearchField}
        hiddenSearchFields={HIDDEN_SEARCH_FIELDS}
        searchLeftSlot={filtersButton}
        // No chips placeholder here: this screen's ActiveFilterChips renders
        // nothing at all when no filter is set, so reserving a row for it would
        // more often than not leave an empty band that vanishes on mount. The
        // Filters button lives in the search row above, so `false` (not
        // omitted) — omitting it would bring back the placeholder pills.
        filterRow={false}
      />
    );
  }
  return (
    <CinemaShowtimesContent
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchField={searchField}
      onChangeSearchField={setSearchField}
      filtersButton={filtersButton}
      filtersModalVisible={filtersModalVisible}
      setFiltersModalVisible={setFiltersModalVisible}
    />
  );
}

function CinemaShowtimesContent({
  searchQuery,
  onSearchChange,
  searchField,
  onChangeSearchField,
  filtersButton,
  filtersModalVisible,
  setFiltersModalVisible,
}: {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchField: SearchField;
  onChangeSearchField: (searchField: SearchField) => void;
  filtersButton: ReactElement;
  filtersModalVisible: boolean;
  setFiltersModalVisible: (visible: boolean) => void;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const { id, name, city, badgeBgColor, url } = useLocalSearchParams<{
    id?: string | string[];
    name?: string | string[];
    city?: string | string[];
    badgeBgColor?: string | string[];
    url?: string | string[];
  }>();
  const routeCinemaId = useMemo(() => Number(getRouteParam(id)), [id]);
  const cinemaId = Number.isFinite(routeCinemaId) && routeCinemaId > 0 ? routeCinemaId : -1;
  const goToMovieFromCard = useSingleFireNavigation((movieId: number) =>
    router.push({
      pathname: "/movie/[id]",
      params: { id: String(movieId), cinemaId: String(cinemaId) },
    })
  );
  const routeCinemaName = useMemo(() => getRouteParam(name)?.trim() ?? "", [name]);
  const routeCityName = useMemo(() => getRouteParam(city)?.trim() ?? "", [city]);
  // Carried from CinemaPill's navigation params so the badge color and website
  // link are available on the very first frame, rather than flashing in once
  // the cinemas list finishes fetching.
  const routeBadgeBgColor = useMemo(() => getRouteParam(badgeBgColor)?.trim() ?? "", [badgeBgColor]);
  const routeUrl = useMemo(() => getRouteParam(url)?.trim() ?? "", [url]);
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());

  const {
    selectedShowtimeFilter,
    appliedShowtimeFilter,
    setSelectedShowtimeFilter,
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
    appliedGroupByMovie,
    setGroupByMovie,
    selectedDays: sharedSelectedDays,
    setSelectedDays,
    selectedTimeRanges: sharedSelectedTimeRanges,
    setSelectedTimeRanges,
    selectedRuntimeRanges: sharedSelectedRuntimeRanges,
    setSelectedRuntimeRanges,
    selectedListIds,
    setSelectedListIds,
    excludeListIds,
    setExcludeListIds,
    selectedLanguages,
    setSelectedLanguages,
  } = useSharedTabFilters();
  const { user } = useAuth();
  // The status filter is about who is going; a guest has no such answer to
  // filter by, so it is not offered here either (see FiltersModalProvider).
  const isSignedIn = useIsSignedIn();
  const isFocused = useIsFocused();
  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());
  const effectiveWatchlistOnly = hasLetterboxdUsername ? watchlistOnly : false;
  const effectiveAppliedWatchlistOnly = hasLetterboxdUsername ? appliedWatchlistOnly : false;
  const effectiveWatchlistExclude = hasLetterboxdUsername ? watchlistExclude : false;
  const effectiveHideWatched = hasLetterboxdUsername ? hideWatched : false;
  const effectiveAppliedHideWatched = hasLetterboxdUsername ? appliedHideWatched : false;
  const effectiveWatchedOnly = hasLetterboxdUsername ? watchedOnly : false;
  const selectedDays = sharedSelectedDays ?? EMPTY_DAYS;
  const selectedTimeRanges = sharedSelectedTimeRanges ?? EMPTY_TIME_RANGES;
  const selectedRuntimeRanges = sharedSelectedRuntimeRanges ?? EMPTY_RUNTIME_RANGES;
  const dayAnchorKey =
    DateTime.now().setZone("Europe/Amsterdam").startOf("day").toISODate() ?? "";
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
  const { data: cinemas } = useFetchCinemas();
  const debouncedSearchQuery = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);
  // Clearing the field drops the results immediately — waiting out the
  // debounce to remove what the user just deleted would feel broken.
  const effectiveSearchQuery = searchQuery.trim().length > 0 ? debouncedSearchQuery : "";

  useEffect(() => {
    if (hasLetterboxdUsername || !watchlistOnly) return;
    setWatchlistOnly(false);
  }, [hasLetterboxdUsername, setWatchlistOnly, watchlistOnly]);

  useEffect(() => {
    if (hasLetterboxdUsername || !hideWatched) return;
    setHideWatched(false);
  }, [hasLetterboxdUsername, setHideWatched, hideWatched]);

  const cinemaFromList = useMemo(
    () => cinemas?.find((cinemaValue) => cinemaValue.id === cinemaId),
    [cinemaId, cinemas]
  );
  const cinemaName = routeCinemaName || cinemaFromList?.name || "Cinema";
  const cityName = routeCityName || cinemaFromList?.city.name || "";
  const topBarTitleSuffix = cityName || undefined;
  const badgeBgColorKey = routeBadgeBgColor || cinemaFromList?.badge_bg_color || "";
  const cinemaUrl = routeUrl || cinemaFromList?.url || "";
  const { topBarAccentColor, handleOpenLocation, topBarLinkUrl } = buildCinemaHeaderProps({
    cinemaName,
    cityName,
    badgeBgColorKey,
    url: cinemaUrl,
    colors,
  });

  // ─── Showtimes query ─────────────────────────────────────────────────────────
  const showtimesFilters = useMemo(() => ({
    query: effectiveSearchQuery || undefined,
    searchField,
    selectedCinemaIds: [cinemaId],
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
    cinemaId,
    effectiveSearchQuery,
    searchField,
    resolvedApiDays,
    appliedShowtimeFilter,
    selectedTimeRanges,
    runtimeBounds.runtimeMin,
    runtimeBounds.runtimeMax,
    effectiveAppliedWatchlistOnly,
    effectiveWatchlistExclude,
    effectiveAppliedHideWatched,
    effectiveWatchedOnly,
    selectedListIds,
    excludeListIds,
    selectedLanguages,
  ]);

  const {
    data: showtimesData,
    isLoading: showtimesLoading,
    isFetchingNextPage: showtimesFetchingNextPage,
    isFetching: showtimesFetching,
    hasNextPage: showtimesHasNextPage,
    fetchNextPage: showtimesFetchNextPage,
  } = useFetchMainPageShowtimes({
    limit: 20,
    firstPageLimit: SHOWTIMES_FIRST_PAGE_LIMIT,
    snapshotTime,
    filters: showtimesFilters,
    enabled: isFocused && !appliedGroupByMovie,
  });

  const showtimes = useMemo(() => showtimesData?.pages.flat() ?? [], [showtimesData]);

  // ─── Movies query (Group by Movie mode) ──────────────────────────────────────
  const moviesFilters = useMemo(() => ({
    query: effectiveSearchQuery || undefined,
    searchField,
    selectedCinemaIds: [cinemaId],
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
    cinemaId,
    effectiveSearchQuery,
    searchField,
    resolvedApiDays,
    appliedShowtimeFilter,
    selectedTimeRanges,
    runtimeBounds.runtimeMin,
    runtimeBounds.runtimeMax,
    effectiveAppliedWatchlistOnly,
    effectiveWatchlistExclude,
    effectiveAppliedHideWatched,
    effectiveWatchedOnly,
    selectedListIds,
    excludeListIds,
    selectedLanguages,
  ]);

  const {
    data: moviesData,
    isLoading: moviesLoading,
    isFetchingNextPage: moviesFetchingNextPage,
    isFetching: moviesFetching,
    hasNextPage: moviesHasNextPage,
    fetchNextPage: moviesFetchNextPage,
  } = useFetchMovies({
    limit: 20,
    firstPageLimit: MOVIES_FIRST_PAGE_LIMIT,
    snapshotTime,
    filters: moviesFilters,
    enabled: isFocused && appliedGroupByMovie,
  });

  const movies = useMemo(() => moviesData?.pages.flat() ?? [], [moviesData]);

  // Stable across renders: it reaches every card through the list's
  // `renderItem`, and a new object there re-renders all of them.
  const showtimeModalOptions = useMemo(() => ({ openedFrom: { cinemaId } }), [cinemaId]);

  // One identity for the life of the list: a new `renderItem` re-renders every
  // cell, which would undo `MovieCard`'s memo.
  const openMovie = useCallback(
    (movie: { id: number }) => goToMovieFromCard(movie.id),
    [goToMovieFromCard]
  );
  const renderMovie = useCallback(
    ({ item, index }: { item: MovieSummaryPublic; index: number }) => (
      <FeedItemEntrance index={index}>
        <MovieCard movie={item} onPress={openMovie} showCinema={false} />
      </FeedItemEntrance>
    ),
    [openMovie]
  );

  const loadMoreMovies = useScrollTriggeredLoadMore(() => {
    if (moviesHasNextPage && !moviesFetchingNextPage) moviesFetchNextPage();
  });

  // ─── Handlers ────────────────────────────────────────────────────────────────
  // One snapshot drives both the showtimes and movies queries, so which mode
  // is on screen no longer changes what a refresh has to do — and the refresh
  // is not over until whichever of them is on screen has its rows back.
  const { refreshing, handleRefresh } = useSnapshotRefresh({
    setSnapshotTime,
    isFetching: showtimesFetching || moviesFetching,
  });

  const handleLoadMore = () => {
    if (showtimesHasNextPage && !showtimesFetchingNextPage) {
      showtimesFetchNextPage();
    }
  };

  const handleClearAll = () => {
    setSelectedShowtimeFilter("all");
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
  };

  // Same notice under either feed's empty state: the search field is shared by
  // both, and so is the reason an unexpected empty result turns up.
  const searchFieldFallback = (
    <SearchFieldFallback
      searchField={searchField}
      query={effectiveSearchQuery}
      onSearchByTitle={() => onChangeSearchField("title")}
    />
  );

  // ─── Render ───────────────────────────────────────────────────────────────────
  // The applied value, not the chip's: it is what decides which feed is
  // mounted, and it lands a frame after the tap so that swapping the feed
  // never happens in the frame the chip's own animation starts. See
  // `useSharedTabFilters`.
  const isLoading = appliedGroupByMovie ? moviesLoading : showtimesLoading;
  const isFetching = appliedGroupByMovie ? moviesFetching : showtimesFetching;
  const resultCount = appliedGroupByMovie ? movies.length : showtimes.length;

  // Pull-to-refresh no longer clears the list: RefreshControl's own spinner
  // at the top already says a reload is happening, so the old cards just
  // stay up and get swapped for the fresh ones once they land — no separate
  // "reload" state needed, and nothing for the loading panel to do here.
  const visibleMovies = movies;

  // `!refreshing`: RefreshControl's own spinner already covers a
  // pull-to-refresh, so the panel has nothing to do for one even on an
  // already-empty list. Both a genuine first load and a background refetch
  // go through the same delay+cooldown — a preset or filter combo that's
  // been used before (or just hits a nearby cache entry) very often resolves
  // faster than LOADING_LOGO_DELAY_MS even with nothing cached yet, so
  // showing `moviesLoading` immediately just moved the flash from "quick
  // filter taps" to "quick presets" instead of removing it.
  const isMoviesEmptyLoading =
    (moviesLoading || moviesFetching) && !refreshing && movies.length === 0;
  const showMoviesLoadingLogo = useDelayedTrue(
    isMoviesEmptyLoading,
    LOADING_LOGO_DELAY_MS,
    LOADING_LOGO_COOLDOWN_MS
  );

  const moviesContent = appliedGroupByMovie ? (
    <View style={styles.flex}>
      <FlatList
        style={styles.flex}
        data={visibleMovies}
        renderItem={renderMovie}
        keyExtractor={byIdKeyExtractor}
        contentContainerStyle={styles.movieFeed}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          // The loading panel is a fixed overlay (below), not part of the
          // list's own content, so there's nothing to render here while it's
          // up. And never the "nothing found" copy while a refresh is in
          // flight either — the pull gesture's own spinner already covers
          // that, and this would otherwise flash up for an already-empty list
          // mid-refresh even though the loading panel is deliberately skipped
          // for that case.
          isMoviesEmptyLoading || refreshing ? null : (
            <View style={styles.centerContainer}>
              <ThemedText style={styles.emptyText}>No movies found</ThemedText>
              {searchFieldFallback}
            </View>
          )
        }
        ListFooterComponent={<LoadMoreFooter loading={moviesFetchingNextPage} size="small" />}
        onScrollBeginDrag={loadMoreMovies.onScrollBeginDrag}
        onEndReached={loadMoreMovies.onEndReached}
        onEndReachedThreshold={2}
        refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      />
      {/* An overlay, not the list's ListEmptyComponent: that content scrolls
          and shifts with RefreshControl's pull, which read as the logo
          drifting down the screen. Sitting outside the FlatList keeps it
          fixed in place and (via pointerEvents="none") never intercepts the
          pull-to-refresh gesture underneath it. */}
      {showMoviesLoadingLogo ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ListLoadingLogo />
        </View>
      ) : null}
    </View>
  ) : undefined;

  return (
    <>
      <ShowtimesScreen
        topBarTitle={cinemaName}
        topBarTitleSuffix={topBarTitleSuffix}
        topBarShowBackButton
        topBarAccentColor={topBarAccentColor}
        topBarOnTitleSuffixPress={handleOpenLocation}
        topBarLinkUrl={topBarLinkUrl}
        showtimes={showtimes}
        isLoading={isLoading}
        isFetching={isFetching}
        isFetchingNextPage={showtimesFetchingNextPage}
        hasNextPage={showtimesHasNextPage}
        onLoadMore={handleLoadMore}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        searchField={searchField}
        onChangeSearchField={onChangeSearchField}
        hiddenSearchFields={HIDDEN_SEARCH_FIELDS}
        searchLeftSlot={filtersButton}
        filterRow={
          <ActiveFilterChips
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
            selectedShowtimeFilter={selectedShowtimeFilter}
            setSelectedShowtimeFilter={setSelectedShowtimeFilter}
            showStatusFilter={isSignedIn}
            selectedDays={selectedDays}
            setSelectedDays={setSelectedDays}
            selectedTimeRanges={selectedTimeRanges}
            setSelectedTimeRanges={setSelectedTimeRanges}
            selectedRuntimeRanges={selectedRuntimeRanges}
            setSelectedRuntimeRanges={setSelectedRuntimeRanges}
            selectedListIds={selectedListIds}
            setSelectedListIds={setSelectedListIds}
            excludeListIds={excludeListIds}
            setExcludeListIds={setExcludeListIds}
            selectedLanguages={selectedLanguages}
            setSelectedLanguages={setSelectedLanguages}
            onClearAll={handleClearAll}
          />
        }
        listContent={moviesContent}
        emptyText="No showtimes for this cinema"
        emptyExtra={searchFieldFallback}
        openModalOptions={showtimeModalOptions}
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
        selectedShowtimeFilter={selectedShowtimeFilter}
        setSelectedShowtimeFilter={setSelectedShowtimeFilter}
        showStatusFilter={isSignedIn}
        showCinemas={false}
        selectedDays={selectedDays}
        setSelectedDays={setSelectedDays}
        selectedTimeRanges={selectedTimeRanges}
        setSelectedTimeRanges={setSelectedTimeRanges}
        selectedRuntimeRanges={selectedRuntimeRanges}
        setSelectedRuntimeRanges={setSelectedRuntimeRanges}
        selectedListIds={selectedListIds}
        setSelectedListIds={setSelectedListIds}
        excludeListIds={excludeListIds}
        setExcludeListIds={setExcludeListIds}
        selectedLanguages={selectedLanguages}
        setSelectedLanguages={setSelectedLanguages}
        showLists
        resultCount={resultCount}
      />
    </>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    flex: { flex: 1 },
    movieFeed: { padding: 16 },
    loadingOverlay: { ...StyleSheet.absoluteFillObject },
    centerContainer: { paddingVertical: 40, alignItems: "center" },
    emptyText: { fontSize: 16, color: colors.textSecondary },
  });
