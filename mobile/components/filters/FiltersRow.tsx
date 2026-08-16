/**
 * Mobile filter UI component: Filters Row.
 * Pinned "Filters" pill + a scrollable row of saved-preset buttons.
 *
 * The preset buttons are actions, not selectors: tapping one applies its
 * selections (and leaves everything else unchanged). When the user has no
 * presets a hint takes their place, opening the Filters modal where presets
 * are saved.
 */
import type { Ref } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import SavedPresetChips from "@/components/filters/SavedPresetChips";
import { type DisplayPreset } from "@/components/filters/saved-presets";
import { useIsSignedIn } from "@/utils/auth-session";
import { triggerSelectionHaptic } from "@/utils/long-press";

export type FiltersRowProps = {
  onOpenModal: () => void;
  onApplyPreset: (preset: DisplayPreset) => void;
  /**
   * Handed out so the first-run intro can measure the Filters button and
   * highlight it in place (see `IntroFiltersSpotlight`).
   */
  filtersButtonRef?: Ref<View>;
};

export default function FiltersRow({
  onOpenModal,
  onApplyPreset,
  filtersButtonRef,
}: FiltersRowProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Saved presets belong to an account, so for a guest the row is the Filters
  // button alone — the separator would otherwise draw a line to nothing.
  const isSignedIn = useIsSignedIn();

  return (
    <View style={styles.container}>
      {/* Pinned Filters button — never scrolls away */}
      <TouchableOpacity
        ref={filtersButtonRef}
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

      {isSignedIn ? (
        <>
          {/* Vertical separator */}
          <View style={styles.separator} />

          {/* Scrollable preset buttons */}
          <SavedPresetChips onApply={onApplyPreset} />
        </>
      ) : null}
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
      borderWidth: 1,
      borderColor: colors.pillBorder,
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
