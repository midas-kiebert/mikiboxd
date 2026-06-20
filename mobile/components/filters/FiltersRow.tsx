/**
 * Mobile filter UI component: Filters Row.
 * Pinned "Filters" pill + a scrollable row of saved-preset buttons.
 *
 * The preset buttons are actions, not selectors: tapping one applies its
 * selections (and leaves everything else unchanged). When the user has no
 * presets a hint takes their place, opening the Filters modal where presets
 * are saved.
 */
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import SavedPresetChips from "@/components/filters/SavedPresetChips";
import { type DisplayPreset } from "@/components/filters/saved-presets";
import { triggerSelectionHaptic } from "@/utils/long-press";

export type FiltersRowProps = {
  onOpenModal: () => void;
  onApplyPreset: (preset: DisplayPreset) => void;
};

export default function FiltersRow({ onOpenModal, onApplyPreset }: FiltersRowProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      {/* Pinned Filters button — never scrolls away */}
      <TouchableOpacity
        style={[styles.pill, styles.filtersPill]}
        onPress={() => {
          triggerSelectionHaptic();
          onOpenModal();
        }}
        activeOpacity={0.8}
      >
        <View style={styles.pillContent}>
          <MaterialIcons name="tune" size={14} color={colors.pillText} />
          <ThemedText style={styles.pillText}>Filters</ThemedText>
        </View>
      </TouchableOpacity>

      {/* Vertical separator */}
      <View style={styles.separator} />

      {/* Scrollable preset buttons */}
      <SavedPresetChips onApply={onApplyPreset} variant="chips" />
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    container: {
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      backgroundColor: colors.background,
      paddingVertical: 10,
    },
    filtersPill: {
      marginLeft: 16,
      flexShrink: 0,
    },
    separator: {
      width: 1,
      height: 20,
      backgroundColor: colors.divider,
      marginHorizontal: 10,
      flexShrink: 0,
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
