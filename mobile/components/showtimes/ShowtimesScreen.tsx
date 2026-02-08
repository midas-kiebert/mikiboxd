import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ShowtimeLoggedIn } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import TopBar from "@/components/layout/TopBar";
import SearchBar from "@/components/inputs/SearchBar";
import FilterPills from "@/components/filters/FilterPills";
import ShowtimeCard from "@/components/showtimes/ShowtimeCard";

type FilterOption = {
  id: string;
  label: string;
};

type ShowtimesScreenProps = {
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
  filters: FilterOption[];
  selectedFilter: string;
  onSelectFilter: (id: string) => void;
  activeFilterIds?: string[];
  emptyText?: string;
};

export default function ShowtimesScreen({
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
  selectedFilter,
  onSelectFilter,
  activeFilterIds,
  emptyText = "No showtimes found",
}: ShowtimesScreenProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const renderFooter = () => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  };

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

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TopBar />
      <SearchBar
        value={searchQuery}
        onChangeText={onSearchChange}
        placeholder="Search showtimes"
      />
      <FilterPills
        filters={filters}
        selectedId={selectedFilter}
        onSelect={onSelectFilter}
        activeIds={activeFilterIds}
      />
      <FlatList
        data={showtimes}
        renderItem={({ item }) => <ShowtimeCard showtime={item} />}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onEndReached={onLoadMore}
        onEndReachedThreshold={2}
        refreshing={isLoading}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        }
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
