/**
 * Mobile showtimes feature component: Showtimes Screen.
 */
import React from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { ThemedRefreshControl } from "@/components/themed-refresh-control";
import TopSafeAreaView from "@/components/layout/TopSafeAreaView";
import { type ShowtimeLoggedIn } from "shared";
import { usePrefetchShowtimeVisibility } from "shared/hooks/useShowtimeVisibility";

import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { useSingleFireNavigation } from "@/hooks/useSingleFireNavigation";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useShowtimeModal, type OpenOptions } from "@/components/showtimes/ShowtimeModalProvider";
import TopBar from "@/components/layout/TopBar";
import SearchBar from "@/components/inputs/SearchBar";
import FilterPills, {
  type FilterPillLongPressPosition,
} from "@/components/filters/FilterPills";
import ShowtimeCard from "@/components/showtimes/ShowtimeCard";
import LoadMoreFooter from "@/components/ui/LoadMoreFooter";
import { Skeleton } from "@/components/ui/Skeleton";

type ShowtimesListContentProps = {
  showtimes: ShowtimeLoggedIn[];
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage?: boolean;
  onLoadMore: () => void;
  refreshing: boolean;
  onRefresh: () => void | Promise<void>;
  emptyText?: string;
  openModalOptions?: OpenOptions;
  /** Carry the showtimes-tab filters over when long-pressing into the movie page. */
  inheritFiltersOnMovieNav?: boolean;
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
  openModalOptions,
  inheritFiltersOnMovieNav = false,
}: ShowtimesListContentProps) {
  const router = useRouter();
  const goToMovieFromLongPress = useSingleFireNavigation((showtime: ShowtimeLoggedIn) =>
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
  // Every card here opens the showtime sheet, so its visibility mode is
  // fetched up front — otherwise the sheet's mode pill loads on open.
  usePrefetchShowtimeVisibility(showtimes.map((showtime) => showtime.id));

  // Always mounted at a fixed height: it doubles as the list's end spacer, so
  // reaching the bottom never changes the layout under the user's scroll.
  const renderFooter = () => <LoadMoreFooter loading={isFetchingNextPage} />;

  const renderEmpty = () => {
    if (isLoading || isFetching || refreshing) {
      // Skeleton cards (rather than a lone spinner) so the list keeps its shape
      // while data loads instead of popping in.
      return (
        <View>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} style={styles.skeletonCard} />
          ))}
        </View>
      );
    }
    return (
      <View style={styles.centerContainer}>
        <ThemedText style={styles.emptyText}>{emptyText}</ThemedText>
      </View>
    );
  };

  // While pull-to-refresh is running, clear the list so it visibly reloads into
  // skeletons and back — otherwise an unchanged result looks like nothing
  // happened. The fresh data renders the moment `refreshing` flips back to false.
  const data = refreshing ? [] : showtimes;

  return (
    <View style={styles.container}>
      <FlatList
        data={data}
        renderItem={({ item }) => (
          <ShowtimeCard
            showtime={item}
            onPress={(showtime) => openShowtimeModal(showtime, openModalOptions)}
            onLongPress={goToMovieFromLongPress}
          />
        )}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) onLoadMore();
        }}
        onEndReachedThreshold={2}
        refreshing={isLoading}
        refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
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
  showtimes: ShowtimeLoggedIn[];
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage?: boolean;
  onLoadMore: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
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
  openModalOptions?: OpenOptions;
  inheritFiltersOnMovieNav?: boolean;
};

export default function ShowtimesScreen<TFilterId extends string = string>({
  topBarTitle = "MiKiNO",
  topBarTitleSuffix,
  topBarShowBackButton = false,
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
  filters,
  activeFilterIds,
  onToggleFilter,
  onLongPressFilter,
  filterRow,
  listContent,
  emptyText = "No showtimes found",
  openModalOptions,
  inheritFiltersOnMovieNav,
}: ShowtimesScreenProps<TFilterId>) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar
        title={topBarTitle}
        titleSuffix={topBarTitleSuffix}
        showBackButton={topBarShowBackButton}
      />
      <SearchBar
        value={searchQuery}
        onChangeText={onSearchChange}
        placeholder="Search showtimes"
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
          openModalOptions={openModalOptions}
          inheritFiltersOnMovieNav={inheritFiltersOnMovieNav}
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
  searchQuery,
  onSearchChange,
  searchPlaceholder = "Search showtimes",
  filterRow,
}: {
  topBarTitle?: string;
  topBarTitleSuffix?: string;
  topBarShowBackButton?: boolean;
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
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
      />
      {onSearchChange ? (
        <SearchBar
          value={searchQuery ?? ""}
          onChangeText={onSearchChange}
          placeholder={searchPlaceholder}
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
      <View style={styles.listContent}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} style={styles.skeletonCard} />
        ))}
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
      paddingTop: 12,
      paddingHorizontal: 16,
      // Matches the movie feeds' padding: a list short enough not to render the
      // end-of-list spacer would otherwise butt straight against the tab bar.
      paddingBottom: 16,
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
    skeletonCard: {
      height: 112,
      borderRadius: 12,
      marginBottom: 16,
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
