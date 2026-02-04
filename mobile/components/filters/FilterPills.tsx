import { FlatList, StyleSheet, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type FilterOption = {
  id: string;
  label: string;
};

type FilterPillsProps = {
  filters: FilterOption[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export default function FilterPills({ filters, selectedId, onSelect }: FilterPillsProps) {
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
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.pill,
              selectedId === item.id && styles.pillActive,
            ]}
            onPress={() => onSelect(item.id)}
          >
            <ThemedText
              numberOfLines={1}
              style={[
                styles.pillText,
                selectedId === item.id && styles.pillTextActive,
              ]}
            >
              {item.label}
            </ThemedText>
          </TouchableOpacity>
        )}
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
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: colors.pillBackground,
      marginRight: 2,
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
  });
