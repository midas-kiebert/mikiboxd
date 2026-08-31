/**
 * Mobile showtimes feature component: Showtimes Screen.
 */
import React from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { ThemedRefreshControl } from "@/components/themed-refresh-control";
import TopSafeAreaView from "@/components/layout/TopSafeAreaView";
import { type ShowtimePublic } from "shared";
import type { SearchField } from "shared/client";
import { usePrefetchShowtimeVisibility } from "shared/hooks/useShowtimeVisibility";
import { usePrefetchShowtimeSeatAvailability } from "shared/hooks/useShowtimeSeatAvailability";

import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { useSingleFireNavigation } from "@/hooks/useSingleFireNavigation";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useDelayedTrue } from "@/hooks/useDelayedTrue";
import { useShowtimeModal, type OpenOptions } from "@/components/showtimes/ShowtimeModalProvider";
import { useIsSignedIn } from "@/utils/auth-session";
import TopBar from "@/components/layout/TopBar";
import SearchBar from "@/components/inputs/SearchBar";
import FilterPills, {
  type FilterPillLongPressPosition,
} from "@/components/filters/FilterPills";
import ShowtimeCard from "@/components/showtimes/ShowtimeCard";
import {
  byIdKeyExtractor,
  useScrollTriggeredLoadMore,
} from "@/components/feeds/feed-paging";
import LoadMoreFooter from "@/components/ui/LoadMoreFooter";
import { Skeleton } from "@/components/ui/Skeleton";
import { FeedItemEntrance } from "@/components/ui/FeedItemEntrance";
import ListLoadingLogo from "@/components/layout/ListLoadingLogo";
import { tabletCappedContentStyle } from "@/constants/tablet-layout";
import { LOADING_LOGO_DELAY_MS, LOADING_LOGO_COOLDOWN_MS } from "@/constants/loading-logo";

type ShowtimesListContentProps = {
  showtimes: ShowtimePublic[];
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage?: boolean;
  onLoadMore: () => void;
  refreshing: boolean;
  onRefresh: () => void | Promise<void>;
  emptyText?: string;
  /** Rendered under `emptyText` when the list is empty (e.g. a search-field notice). */
  emptyExtra?: React.ReactNode;
  openModalOptions?: OpenOptions;
  /** Carry the showtimes-tab filters over when long-pressing into the movie page. */
  inheritFiltersOnMovieNav?: boolean;
  /** Scrolls away with the list, unlike filterRow which stays pinned above it. */
  listHeader?: React.ReactElement | null;
};

export function ShowtimesListContent({
  showtimes,
  isLoading,
  isFetching,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  refreshing,
  onRefresh,
  emptyText = "No showtimes found",
  emptyExtra,
  openModalOptions,
  inheritFiltersOnMovieNav = false,
  listHeader,
}: ShowtimesListContentProps) {
  const router = useRouter();
  const goToMovieFromLongPress = useSingleFireNavigation((showtime: ShowtimePublic) =>
    router.push({
      pathname: "/movie/[id]",
      params: {
        id: String(showtime.movie.id),
        cinemaId: String(showtime.cinema.id),
        ...(inheritFiltersOnMovieNav ? { inheritFilters: "1" } : {}),
      },
    })
  );
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { openShowtimeModal } = useShowtimeModal();
  const isSignedIn = useIsSignedIn();
  // Every card here opens the showtime sheet, so its visibility mode is
  // fetched up front — otherwise the sheet's mode pill loads on open. The pill
  // is on the signed-in sheet only, so for a guest there is nothing to warm.
  usePrefetchShowtimeVisibility(showtimes.map((showtime) => showtime.id), {
    enabled: isSignedIn,
  });
  // How busy each showtime is, on the other hand, is the same fact for
  // everyone and is drawn on the card itself — so it is warmed for guests too.
  usePrefetchShowtimeSeatAvailability(showtimes.map((showtime) => showtime.id));

  // Always mounted at a fixed height: it doubles as the list's end spacer, so
  // reaching the bottom never changes the layout under the user's scroll.
  const renderFooter = () => <LoadMoreFooter loading={isFetchingNextPage} />;

  // One identity each, for the life of the list. A `FlatList` re-renders every
  // cell when `renderItem` changes, which undoes `ShowtimeCard`'s memo — and
  // the whole point of the memo is that a tab switch, which re-renders this
  // screen for no reason the cards care about, costs nothing.
  const openModal = React.useCallback(
    (showtime: ShowtimePublic) => openShowtimeModal(showtime, openModalOptions),
    [openShowtimeModal, openModalOptions]
  );
  const renderItem = React.useCallback(
    ({ item, index }: { item: ShowtimePublic; index: number }) => (
      <FeedItemEntrance index={index}>
        <ShowtimeCard showtime={item} onPress={openModal} onLongPress={goToMovieFromLongPress} />
      </FeedItemEntrance>
    ),
    [openModal, goToMovieFromLongPress]
  );

  // Pull-to-refresh no longer clears the list: RefreshControl's own spinner
  // at the top already says a reload is happening, so the old cards just
  // stay up and get swapped for the fresh ones once they land — no separate
  // "reload" state needed, and nothing for the loading panel to do here.
  const data = showtimes;

  // `isLoading` means there's no cached data at all for this query — nothing
  // to lose by showing the panel immediately, and a delay here is exactly the
  // "blank screen for too long" a genuine first load (or a filter combo
  // that's never been fetched before) doesn't need. `isFetching`-only (data
  // already empty, but a background refetch is running) is the case that can
  // resolve from cache almost instantly, so that one keeps the anti-flash
  // delay and cooldown. `!refreshing` on both: RefreshControl's own spinner
  // already covers a pull-to-refresh, so the panel has nothing to do for one
  // even on an already-empty list.
  const isFirstLoadEmpty = isLoading && !refreshing && data.length === 0;
  const isBackgroundFetchEmpty = isFetching && !isLoading && !refreshing && data.length === 0;
  const showBackgroundFetchLoadingLogo = useDelayedTrue(
    isBackgroundFetchEmpty,
    LOADING_LOGO_DELAY_MS,
    LOADING_LOGO_COOLDOWN_MS
  );
  const showLoadingLogo = isFirstLoadEmpty || showBackgroundFetchLoadingLogo;
  const isEmptyLoading = isFirstLoadEmpty || isBackgroundFetchEmpty;

  const renderEmpty = () => {
    // The loading panel is a fixed overlay (below), not part of the list's
    // own content, so there's nothing to render here while it's up.
    if (isEmptyLoading) return null;
    return (
      <View style={styles.centerContainer}>
        <ThemedText style={styles.emptyText}>{emptyText}</ThemedText>
        {emptyExtra}
      </View>
    );
  };

  const loadMore = useScrollTriggeredLoadMore(() => {
    if (hasNextPage && !isFetchingNextPage) onLoadMore();
  });

  return (
    <View style={styles.container}>
      <FlatList
        data={data}
        renderItem={renderItem}
        keyExtractor={byIdKeyExtractor}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          listHeader ? <View style={styles.listHeaderWrapper}>{listHeader}</View> : undefined
        }
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onScrollBeginDrag={loadMore.onScrollBeginDrag}
        onEndReached={loadMore.onEndReached}
        onEndReachedThreshold={2}
        refreshing={isLoading}
        refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
      {/* An overlay, not the list's ListEmptyComponent: that content scrolls
          and shifts with RefreshControl's pull, which read as the logo
          drifting down the screen. Sitting outside the FlatList keeps it
          fixed in place and (via pointerEvents="none") never intercepts the
          pull-to-refresh gesture underneath it. */}
      {showLoadingLogo ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ListLoadingLogo />
        </View>
      ) : null}
    </View>
  );
}

type FilterOption<TId extends string = string> = {
  id: TId;
  label: string;
  badgeCount?: number;
  activeBackgroundColor?: string;
  activeTextColor?: string;
  activeBorderColor?: string;
};

type ShowtimesScreenProps<TFilterId extends string = string> = {
  topBarTitle?: string;
  topBarTitleSuffix?: string;
  topBarShowBackButton?: boolean;
  topBarAccentColor?: { background: string; text: string };
  topBarOnTitleSuffixPress?: () => void;
  topBarLinkUrl?: string;
  topBarAvatarInitial?: string;
  showtimes: ShowtimePublic[];
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage?: boolean;
  onLoadMore: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  /**
   * Passing both of these turns the plain search field into the main feed's
   * field-selector one (Title / Director / Actor / …); leaving them off keeps
   * the plain field. `hiddenSearchFields` drops options that make no sense on
   * the screen in question.
   */
  searchField?: SearchField;
  onChangeSearchField?: (searchField: SearchField) => void;
  hiddenSearchFields?: readonly SearchField[];
  /** Sits inside the search row, left of the field — the Filters button, where a screen has one. */
  searchLeftSlot?: React.ReactNode;
  // Legacy pill-based filters — omit when using filterRow slot instead
  filters?: readonly FilterOption<TFilterId>[];
  activeFilterIds?: readonly TFilterId[];
  onToggleFilter?: (id: TFilterId, position?: FilterPillLongPressPosition) => void;
  onLongPressFilter?: (
    id: TFilterId,
    position: FilterPillLongPressPosition
  ) => boolean | void;
  // New slot: replaces FilterPills when provided
  filterRow?: React.ReactElement | null | false;
  // New slot: replaces ShowtimesListContent when provided (e.g. for group-by-movies)
  listContent?: React.ReactNode;
  emptyText?: string;
  /** Rendered under `emptyText` when the list is empty (e.g. a search-field notice). */
  emptyExtra?: React.ReactNode;
  openModalOptions?: OpenOptions;
  inheritFiltersOnMovieNav?: boolean;
  /** Scrolls away with the list, unlike filterRow which stays pinned above it. */
  listHeader?: React.ReactElement | null;
};

export default function ShowtimesScreen<TFilterId extends string = string>({
  topBarTitle = "MiKiNO",
  topBarTitleSuffix,
  topBarShowBackButton = false,
  topBarAccentColor,
  topBarOnTitleSuffixPress,
  topBarLinkUrl,
  topBarAvatarInitial,
  showtimes,
  isLoading,
  isFetching,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  refreshing,
  onRefresh,
  searchQuery,
  onSearchChange,
  searchField,
  onChangeSearchField,
  hiddenSearchFields,
  searchLeftSlot,
  filters,
  activeFilterIds,
  onToggleFilter,
  onLongPressFilter,
  filterRow,
  listContent,
  emptyText = "No showtimes found",
  emptyExtra,
  openModalOptions,
  inheritFiltersOnMovieNav,
  listHeader,
}: ShowtimesScreenProps<TFilterId>) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar
        title={topBarTitle}
        titleSuffix={topBarTitleSuffix}
        showBackButton={topBarShowBackButton}
        accentColor={topBarAccentColor}
        onTitleSuffixPress={topBarOnTitleSuffixPress}
        linkUrl={topBarLinkUrl}
        avatarInitial={topBarAvatarInitial}
      />
      <SearchBar
        value={searchQuery}
        onChangeText={onSearchChange}
        placeholder="Search showtimes"
        searchField={searchField}
        onChangeSearchField={onChangeSearchField}
        hiddenSearchFields={hiddenSearchFields}
        leftSlot={searchLeftSlot}
        clearOnAndroidBack
      />
      {filterRow ?? (
        <FilterPills
          filters={filters ?? []}
          selectedId=""
          onSelect={onToggleFilter ?? (() => {})}
          onLongPressSelect={onLongPressFilter}
          activeIds={activeFilterIds ?? []}
        />
      )}
      {listContent !== undefined ? <>{listContent}</> : (
        <ShowtimesListContent
          showtimes={showtimes}
          isLoading={isLoading}
          isFetching={isFetching}
          isFetchingNextPage={isFetchingNextPage}
          hasNextPage={hasNextPage}
          onLoadMore={onLoadMore}
          refreshing={refreshing}
          onRefresh={onRefresh}
          emptyText={emptyText}
          emptyExtra={emptyExtra}
          openModalOptions={openModalOptions}
          inheritFiltersOnMovieNav={inheritFiltersOnMovieNav}
          listHeader={listHeader}
        />
      )}
    </TopSafeAreaView>
  );
}

/**
 * Rendered on a screen's first frame so the push animation can start
 * immediately, before the real (data-fetching) screen mounts. Mirrors the
 * ShowtimesScreen layout: top bar, search, filter row, list of cards.
 *
 * Only the list is genuinely waiting on data. The chrome above it is the
 * screen's frame, so a caller that already owns the search text and the filter
 * row passes them in here and gets the real, already-interactive controls on
 * the first frame — typing and opening the filters work before the content
 * behind them has mounted. Callers with nothing to bind yet fall back to
 * placeholder bars.
 */
export function ShowtimesScreenSkeleton({
  topBarTitle = "MiKiNO",
  topBarTitleSuffix,
  topBarShowBackButton = false,
  topBarAccentColor,
  topBarOnTitleSuffixPress,
  topBarLinkUrl,
  topBarAvatarInitial,
  searchQuery,
  onSearchChange,
  searchPlaceholder = "Search showtimes",
  searchField,
  onChangeSearchField,
  hiddenSearchFields,
  searchLeftSlot,
  filterRow,
}: {
  topBarTitle?: string;
  topBarTitleSuffix?: string;
  topBarShowBackButton?: boolean;
  topBarAccentColor?: { background: string; text: string };
  topBarOnTitleSuffixPress?: () => void;
  topBarLinkUrl?: string;
  topBarAvatarInitial?: string;
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchField?: SearchField;
  onChangeSearchField?: (searchField: SearchField) => void;
  hiddenSearchFields?: readonly SearchField[];
  searchLeftSlot?: React.ReactNode;
  /** `false` (rather than omitted) for a screen with no filter row at all: it skips the placeholder pills. */
  filterRow?: React.ReactNode;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar
        title={topBarTitle}
        titleSuffix={topBarTitleSuffix}
        showBackButton={topBarShowBackButton}
        accentColor={topBarAccentColor}
        onTitleSuffixPress={topBarOnTitleSuffixPress}
        linkUrl={topBarLinkUrl}
        avatarInitial={topBarAvatarInitial}
      />
      {onSearchChange ? (
        <SearchBar
          value={searchQuery ?? ""}
          onChangeText={onSearchChange}
          placeholder={searchPlaceholder}
          searchField={searchField}
          onChangeSearchField={onChangeSearchField}
          hiddenSearchFields={hiddenSearchFields}
          leftSlot={searchLeftSlot}
          clearOnAndroidBack
        />
      ) : (
        <View style={styles.skeletonSearch}>
          <Skeleton style={styles.skeletonSearchBar} />
        </View>
      )}
      {filterRow ?? (
        <View style={styles.skeletonFilterRow}>
          <Skeleton style={{ height: 40, width: 90, borderRadius: 18 }} />
          <Skeleton style={{ height: 40, width: 72, borderRadius: 18 }} />
        </View>
      )}
      <View style={[styles.listContent, styles.listContentFill]}>
        <ListLoadingLogo />
      </View>
    </TopSafeAreaView>
  );
}

/**
 * Stand-in for ActiveFilterChips, which cannot render before the filter state
 * it reflects exists. Same height and divider as the real row, so the chips
 * replace it in place instead of pushing the list down when they arrive.
 */
export function ActiveFilterChipsPlaceholder() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.chipsPlaceholderRow}>
      <Skeleton style={styles.chipsPlaceholderChip} />
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    listContent: {
      ...tabletCappedContentStyle,
      paddingTop: 12,
      paddingHorizontal: 16,
      // Matches the movie feeds' padding: a list short enough not to render the
      // end-of-list spacer would otherwise butt straight against the tab bar.
      paddingBottom: 16,
    },
    // Grows the content container to fill the list's viewport so the loading
    // panel can center within it instead of sizing to its own small height —
    // that's also what stops a short screen from having anything to scroll.
    listContentFill: {
      flexGrow: 1,
    },
    // Absolutely positioned over the list (not part of its scrollable
    // content) so it stays fixed instead of moving with RefreshControl's pull
    // or the content's own scroll offset.
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
    },
    // listHeader supplies its own horizontal padding/divider (it's a full-width
    // section like the card list rows above it), so cancel out listContent's
    // own inset rather than double it up.
    listHeaderWrapper: {
      marginHorizontal: -16,
      marginTop: -12,
      marginBottom: 12,
    },
    skeletonSearch: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.background,
    },
    skeletonSearchBar: {
      height: 48,
      borderRadius: 12,
      backgroundColor: colors.searchBackground,
    },
    skeletonFilterRow: {
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    // Mirrors ActiveFilterChips' own row: 7pt of vertical padding around a
    // 36pt chip, closed off by the same divider. The chip's 36pt (rather than
    // the 5+5+border padding alone would suggest) comes from ThemedText's
    // 24pt default line height, which the real chip's label inherits.
    chipsPlaceholderRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 7,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    chipsPlaceholderChip: {
      height: 36,
      width: 120,
      borderRadius: 14,
    },
    centerContainer: {
      paddingVertical: 40,
      alignItems: "center",
    },
    emptyText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
  });
