/**
 * Shared header for all app bottom sheets: a title with a consistent close
 * button, plus an optional back button (same style) shown when the sheet was
 * opened from within another sheet. Used by {@link AppBottomSheet} so every
 * sheet has an identical header / close affordance.
 */
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { ReactNode } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useThemeColors } from "@/hooks/use-theme-color";

type ThemeColors = typeof import("@/constants/theme").Colors.light;

type BottomSheetHeaderProps = {
  title: string;
  onClose: () => void;
  /** When provided, a back button is rendered on the left. */
  onBack?: () => void;
  /** Optional element rendered just left of the close button. */
  right?: ReactNode;
};

export default function BottomSheetHeader({ title, onClose, onBack, right }: BottomSheetHeaderProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.header}>
      <View style={styles.side}>
        {onBack ? (
          <TouchableOpacity
            onPress={onBack}
            hitSlop={8}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <MaterialIcons name="arrow-back" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.side, styles.sideRight]}>
        {right}
        <TouchableOpacity
          onPress={onClose}
          hitSlop={8}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <MaterialIcons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 6,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    side: {
      minWidth: 32,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    sideRight: {
      justifyContent: "flex-end",
    },
    title: {
      flex: 1,
      textAlign: "center",
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
    },
  });
