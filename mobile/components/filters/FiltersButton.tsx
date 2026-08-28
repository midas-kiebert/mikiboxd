/**
 * Mobile filter UI component: the Filters button.
 *
 * One component wherever the button appears — beside the search field on the
 * main feeds, alone in `FiltersButtonRow` on the sub-pages — so the same
 * control is never two different sizes across screens.
 *
 * It stretches to its parent's height when the parent gives it one (the search
 * row lines it up with the search field that way), and stands at its own
 * height otherwise. Corner radius and type size come from the search field
 * itself, so the pair reads as one control strip rather than as two controls
 * that happen to be adjacent.
 */
import type { Ref } from "react";
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import {
  FILTERS_BUTTON_ICON_SIZE,
  FILTERS_BUTTON_PADDING_VERTICAL,
  FILTERS_BUTTON_TEXT_LINE_HEIGHT,
} from "@/components/filters/filter-control-metrics";
import {
  SEARCH_FIELD_ATTACHED_RADIUS,
  SEARCH_FIELD_FONT_SIZE,
} from "@/components/inputs/SearchBar";
import { triggerSelectionHaptic } from "@/utils/long-press";

type FiltersButtonProps = {
  onPress: () => void;
  /**
   * Handed out so the first-run intro can measure the button and highlight it
   * in place (see `IntroFiltersSpotlight`).
   */
  buttonRef?: Ref<View>;
  style?: StyleProp<ViewStyle>;
};

export default function FiltersButton({ onPress, buttonRef, style }: FiltersButtonProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <TouchableOpacity
      ref={buttonRef}
      style={[styles.button, style]}
      onPress={() => {
        triggerSelectionHaptic();
        onPress();
      }}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Filters"
    >
      <View style={styles.content}>
        <MaterialIcons name="tune" size={FILTERS_BUTTON_ICON_SIZE} color={colors.pillText} />
        <ThemedText style={styles.label}>Filters</ThemedText>
      </View>
    </TouchableOpacity>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    button: {
      paddingHorizontal: 14,
      paddingVertical: FILTERS_BUTTON_PADDING_VERTICAL,
      // The radius the field beside it rests at: every screen that mounts this
      // in a search row shows the mode selector, which is what pulls the field
      // in from its standalone pill radius.
      borderRadius: SEARCH_FIELD_ATTACHED_RADIUS,
      // The field's own surface, not the pill tokens: they are identical in
      // light mode, but `pillBorder` is invisible against `pillBackground` in
      // dark mode, which would leave a flat block beside an outlined field.
      backgroundColor: colors.searchBackground,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      // Keeps the label centred when a parent stretches the button past its
      // own padding, as the search row does.
      justifyContent: "center",
    },
    content: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    label: {
      fontSize: SEARCH_FIELD_FONT_SIZE,
      lineHeight: FILTERS_BUTTON_TEXT_LINE_HEIGHT,
      fontWeight: "500",
      color: colors.pillText,
    },
  });
