/**
 * Mobile showtimes feature component: Showtimes Screen.
 */
import { useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { ShowtimesService, type GoingStatus, type ShowtimeLoggedIn } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import TopBar from "@/components/layout/TopBar";
import SearchBar from "@/components/inputs/SearchBar";
import FilterPills, {
  type FilterPillLongPressPosition,
} from "@/components/filters/FilterPills";
import ShowtimeCard from "@/components/showtimes/ShowtimeCard";
import ShowtimeActionModal from "@/components/showtimes/ShowtimeActionModal";

type FilterOption<TId extends string = string> = {
  id: TId;
  label: string;
  badgeCount?: number;
  activeBackgroundColor?: string;
  activeTextColor?: string;
  activeBorderColor?: string;
};

type AudienceToggleValue = "including-friends" | "only-you";

type AudienceToggleOption = {
  value: AudienceToggleValue;
  onChange: (value: AudienceToggleValue) => void;
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
  filters: ReadonlyArray<FilterOption<TFilterId>>;
  activeFilterIds: ReadonlyArray<TFilterId>;
  onToggleFilter: (id: TFilterId, position?: FilterPillLongPressPosition) => void;
  onLongPressFilter?: (
    id: TFilterId,
    position: FilterPillLongPressPosition
  ) => boolean | void;
  audienceToggle?: AudienceToggleOption;
  emptyText?: string;
};

export default function ShowtimesScreen<TFilterId extends string = string>({
  topBarTitle = "MIKINO",
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
  audienceToggle,
  emptyText = "No showtimes found",
}: ShowtimesScreenProps<TFilterId>) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [selectedShowtime, setSelectedShowtime] = useState<ShowtimeLoggedIn | null>(null);
  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  const { mutate: updateShowtimeSelection, isPending: isUpdatingShowtimeSelection } = useMutation({
    mutationFn: ({ showtimeId, going }: { showtimeId: number; going: GoingStatus }) =>
      ShowtimesService.updateShowtimeSelection({
        showtimeId,
        requestBody: {
          going_status: going,
        },
      }),
    onError: (error) => {
      console.error("Error updating showtime selection:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["showtimes"] });
      queryClient.invalidateQueries({ queryKey: ["movie"] });
      queryClient.invalidateQueries({ queryKey: ["movies"] });
    },
  });

  // Submit the selected going/interested/not-going status.
  const handleShowtimeStatusUpdate = (going: GoingStatus) => {
    if (!selectedShowtime || isUpdatingShowtimeSelection) return;
    setSelectedShowtime((previous) => (previous ? { ...previous, going } : previous));
    updateShowtimeSelection({ showtimeId: selectedShowtime.id, going });
  };

  const isOnlyYouAudienceActive = audienceToggle?.value === "only-you";

  // Render infinite-scroll loading feedback at the bottom of the list.
  const renderFooter = () => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  };

  // Render the empty/loading state when list data is unavailable.
  const renderEmpty = () => {
    if (isLoading || isFetching) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      );
    }
    return (
      <View style={styles.centerContainer}>
        <ThemedText style={styles.emptyText}>{emptyText}</ThemedText>
      </View>
    );
  };

  // Render/output using the state and derived values prepared above.
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TopBar
        title={topBarTitle}
        titleSuffix={topBarTitleSuffix}
        showBackButton={topBarShowBackButton}
      />
      <ShowtimeActionModal
        visible={selectedShowtime !== null}
        showtime={selectedShowtime}
        movieTitle={selectedShowtime?.movie.title}
        isUpdatingStatus={isUpdatingShowtimeSelection}
        onUpdateStatus={handleShowtimeStatusUpdate}
        onClose={() => setSelectedShowtime(null)}
      />
      <SearchBar
        value={searchQuery}
        onChangeText={onSearchChange}
        placeholder="Search showtimes"
      />
      <FilterPills
        filters={filters}
        selectedId=""
        onSelect={onToggleFilter}
        onLongPressSelect={onLongPressFilter}
        activeIds={activeFilterIds}
        compoundRightToggle={
          audienceToggle
            ? {
                anchorId: "showtime-filter",
                label: isOnlyYouAudienceActive ? "Only You" : "Including Friends",
                onPress: () =>
                  audienceToggle.onChange(
                    isOnlyYouAudienceActive ? "including-friends" : "only-you"
                  ),
              }
            : undefined
        }
      />
      <FlatList
        data={showtimes}
        renderItem={({ item }) => (
          <ShowtimeCard showtime={item} onLongPress={(showtime) => setSelectedShowtime(showtime)} />
        )}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onEndReached={() => {
          if (hasNextPage) {
            onLoadMore();
          }
        }}
        onEndReachedThreshold={2}
        refreshing={isLoading}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
    </SafeAreaView>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    listContent: {
      padding: 16,
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
