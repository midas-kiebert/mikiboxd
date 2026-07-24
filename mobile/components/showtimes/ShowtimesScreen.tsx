/**
 * Mobile showtimes feature component: Showtimes Screen.
 */
import React from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { ThemedRefreshControl } from "@/components/themed-refresh-control";
import TopSafeAreaView from "@/components/layout/TopSafeAreaView";
import { type ShowtimeLoggedIn } from "shared";

import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useShowtimeModal, type OpenOptions } from "@/components/showtimes/ShowtimeModalProvider";
import TopBar from "@/components/layout/TopBar";
import SearchBar from "@/components/inputs/SearchBar";
import FilterPills, {
  type FilterPillLongPressPosition,
} from "@/components/filters/FilterPills";
import ShowtimeCard from "@/components/showtimes/ShowtimeCard";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Rendered at the bottom of any paginated list once all pages are loaded.
 * Intentionally just empty scroll space — no end-of-list marker.
 */
export function ListEndFooter(_props: { label?: string }) {
  return <View style={{ height: 64 }} />;
}

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
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { openShowtimeModal } = useShowtimeModal();

  const renderFooter = () => {
    if (isFetchingNextPage) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      );
    }
    if (!hasNextPage && !isLoading && !isFetching && !refreshing && showtimes.length > 0) {
      return <ListEndFooter label="No more showtimes" />;
    }
    return null;
  };

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
            onLongPress={(showtime) =>
              router.push({
                pathname: "/movie/[id]",
                params: {
                  id: String(showtime.movie.id),
                  cinemaId: String(showtime.cinema.id),
                  ...(inheritFiltersOnMovieNav ? { inheritFilters: "1" } : {}),
                },
              })
            }
          />
        )}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onEndReached={() => {
          if (hasNextPage) onLoadMore();
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
 * Lightweight placeholder rendered on a screen's first frame so the native push
 * animation can start immediately, before the real (data-fetching) screen mounts.
 * Mirrors the ShowtimesScreen layout: top bar, search, filter row, list of cards.
 */
export function ShowtimesScreenSkeleton({
  topBarTitle = "MiKiNO",
  topBarTitleSuffix,
  topBarShowBackButton = false,
}: {
  topBarTitle?: string;
  topBarTitleSuffix?: string;
  topBarShowBackButton?: boolean;
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
      <View style={styles.skeletonSearch}>
        <Skeleton style={styles.skeletonSearchBar} />
      </View>
      <View style={styles.skeletonFilterRow}>
        <Skeleton style={{ height: 32, width: 90, borderRadius: 18 }} />
        <Skeleton style={{ height: 32, width: 72, borderRadius: 18 }} />
      </View>
      <View style={styles.listContent}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} style={styles.skeletonCard} />
        ))}
      </View>
    </TopSafeAreaView>
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
    skeletonCard: {
      height: 112,
      borderRadius: 12,
      marginBottom: 16,
    },
    footerLoader: {
      paddingVertical: 20,
      alignItems: "center",
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
