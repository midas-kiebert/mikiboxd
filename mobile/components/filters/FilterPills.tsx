/**
 * Mobile filter UI component: Filter Pills.
 */
import { FlatList, StyleSheet, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type FilterOption<TId extends string = string> = {
  id: TId;
  label: string;
  badgeCount?: number;
  activeBackgroundColor?: string;
  activeTextColor?: string;
  activeBorderColor?: string;
};

type FilterPillsProps<TId extends string = string> = {
  filters: ReadonlyArray<FilterOption<TId>>;
  // For "single select" mode you pass a real id; for "multi active" mode most screens pass "".
  selectedId: TId | "";
  onSelect: (id: TId) => void;
  activeIds?: ReadonlyArray<TId>;
};

export default function FilterPills<TId extends string = string>({
  filters,
  selectedId,
  onSelect,
  activeIds,
}: FilterPillsProps<TId>) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);

  // Nothing to render when the screen has no available filters/tabs.
  if (filters.length === 0) return null;

  // Render/output using the state and derived values prepared above.
  return (
    <View style={styles.container}>
      <FlatList
        data={filters}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          // `activeIds` supports multi-active mode; `selectedId` supports single-select mode.
          const isActive = selectedId === item.id || activeIds?.includes(item.id);
          const showBadge = typeof item.badgeCount === "number" && item.badgeCount > 0;
          const badgeText = item.badgeCount && item.badgeCount > 99 ? "99+" : String(item.badgeCount ?? 0);
          return (
            <TouchableOpacity
              style={[
                styles.pill,
                isActive && styles.pillActive,
                isActive && item.activeBackgroundColor
                  ? { backgroundColor: item.activeBackgroundColor }
                  : null,
                isActive && item.activeBorderColor
                  ? { borderWidth: 1, borderColor: item.activeBorderColor }
                  : null,
              ]}
              onPress={() => onSelect(item.id)}
            >
              <View style={styles.pillContent}>
                <ThemedText
                  numberOfLines={1}
                  style={[
                    styles.pillText,
                    isActive && styles.pillTextActive,
                    isActive && item.activeTextColor ? { color: item.activeTextColor } : null,
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
      backgroundColor: colors.notificationBadge,
      zIndex: 1,
      elevation: 2,
    },
    badgeText: {
      fontSize: 10,
      lineHeight: 10,
      fontWeight: "700",
      color: "#fff",
      includeFontPadding: false,
      textAlignVertical: "center",
    },
  });
