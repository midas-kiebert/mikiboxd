import { FlatList, StyleSheet, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type FilterOption = {
  id: string;
  label: string;
  badgeCount?: number;
};

type FilterPillsProps = {
  filters: FilterOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  activeIds?: string[];
};

export default function FilterPills({ filters, selectedId, onSelect, activeIds }: FilterPillsProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  if (filters.length === 0) return null;

  return (
    <View style={styles.container}>
      <FlatList
        data={filters}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const isActive = selectedId === item.id || activeIds?.includes(item.id);
          const showBadge = typeof item.badgeCount === "number" && item.badgeCount > 0;
          const badgeText = item.badgeCount && item.badgeCount > 99 ? "99+" : String(item.badgeCount ?? 0);
          return (
            <TouchableOpacity
              style={[
                styles.pill,
                isActive && styles.pillActive,
              ]}
              onPress={() => onSelect(item.id)}
            >
              <View style={styles.pillContent}>
                <ThemedText
                  numberOfLines={1}
                  style={[
                    styles.pillText,
                    isActive && styles.pillTextActive,
                  ]}
                >
                  {item.label}
                </ThemedText>
              </View>
              {showBadge ? (
                <View style={styles.badgeCorner}>
                  <ThemedText style={styles.badgeText}>
                    {badgeText}
                  </ThemedText>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      backgroundColor: colors.background,
    },
    list: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 8,
    },
    pill: {
      position: "relative",
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: colors.pillBackground,
      marginRight: 2,
    },
    pillContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    pillActive: {
      backgroundColor: colors.pillActiveBackground,
    },
    pillText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.pillText,
    },
    pillTextActive: {
      color: colors.pillActiveText,
    },
    badgeCorner: {
      position: "absolute",
      top: -6,
      right: -6,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 5,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.red.secondary,
      zIndex: 1,
      elevation: 2,
    },
    badgeText: {
      fontSize: 10,
      fontWeight: "700",
      color: "#fff",
    },
  });
