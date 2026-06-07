/**
 * Mobile filter UI component: Filters Button Row.
 * A minimal row with just the "Filters" button — no preset pills.
 * Used on sub-pages (movie, cinema, friend) where presets are not shown.
 * Accepts an optional rightSlot for extra controls (e.g. the Interested toggle).
 */
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type Props = {
  onPress: () => void;
  rightSlot?: React.ReactNode;
};

export default function FiltersButtonRow({ onPress, rightSlot }: Props) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.pill} onPress={onPress} activeOpacity={0.8}>
        <View style={styles.pillContent}>
          <MaterialIcons name="tune" size={14} color={colors.pillText} />
          <ThemedText style={styles.pillText}>Filters</ThemedText>
        </View>
      </TouchableOpacity>
      {rightSlot}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    container: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      backgroundColor: colors.background,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    pill: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 18,
      backgroundColor: colors.pillBackground,
    },
    pillContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    pillText: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.pillText,
    },
  });
