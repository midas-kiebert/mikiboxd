/**
 * Mobile filter UI component: one active-filter chip.
 *
 * The chip is unchanged — label plus an × that removes only this filter. What
 * it adds is movement: it springs open rather than appearing, collapses with a
 * bounce rather than vanishing, and slides to a new position rather than
 * snapping to one — waiting its turn, when other chips are leaving, so that no
 * two chips are ever drawn on top of each other. A preset apply also tints it by what it did (see
 * `filter-change-animation`); a chip that was already there is not.
 *
 * Nothing here keeps a removed chip alive — Reanimated holds it on screen for
 * its exit, which is why the row above can just stop rendering it.
 */
import { StyleSheet, TouchableOpacity } from "react-native";
import Animated from "react-native-reanimated";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";
import {
  CHIP_LAYOUT_AFTER_EXIT,
  CHIP_LAYOUT_TRANSITION,
  chipEntering,
  chipEnteringAfterExit,
  chipExiting,
  useAddedChipTint,
} from "@/components/filters/filter-change-animation";

type ActiveFilterChipProps = {
  label: string;
  /**
   * Drawn before the label, in place of a word. Only for a filter whose sense
   * would otherwise have to be spelled out — the ⊘ standing in for "Hide" on
   * the excluding filters — since the row is a scroller and every word costs
   * another chip's worth of it.
   */
  icon?: keyof typeof MaterialIcons.glyphMap;
  /** What the chip means in full, for a reader who cannot see the icon. */
  accessibilityLabel?: string;
  onRemove: () => void;
  /** True when a preset apply is what put this chip here. */
  isNew?: boolean;
  /**
   * True on the pass where other chips are leaving. Arriving and moving both
   * wait for them, so nothing is ever drawn over a chip that is still on its
   * way out.
   */
  waitForExits?: boolean;
  /**
   * Reports the chip's laid-out width to the row, which needs it once the chip
   * is gone: see the reserved trailing space in `ActiveFilterChips`.
   */
  onMeasureWidth?: (width: number) => void;
};

export default function ActiveFilterChip({
  label,
  icon,
  accessibilityLabel,
  onRemove,
  isNew = false,
  waitForExits = false,
  onMeasureWidth,
}: ActiveFilterChipProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const tintStyle = useAddedChipTint(isNew);

  return (
    <Animated.View
      style={[styles.chip, tintStyle]}
      entering={waitForExits ? chipEnteringAfterExit : chipEntering}
      exiting={chipExiting}
      layout={waitForExits ? CHIP_LAYOUT_AFTER_EXIT : CHIP_LAYOUT_TRANSITION}
      onLayout={(e) => onMeasureWidth?.(e.nativeEvent.layout.width)}
    >
      <TouchableOpacity
        style={styles.pressable}
        accessibilityRole="button"
        accessibilityLabel={`Remove filter: ${accessibilityLabel ?? label}`}
        onPress={() => {
          // Fired before the removal itself: the chip is gone and its exit
          // under way by the next frame, so a tap felt afterwards would be a
          // tap on something no longer there.
          triggerSelectionHaptic();
          onRemove();
        }}
        activeOpacity={0.75}
        hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
      >
        {icon ? <MaterialIcons name={icon} size={11} color={colors.pillText} /> : null}
        <ThemedText style={styles.chipLabel} numberOfLines={1}>
          {label}
        </ThemedText>
        <MaterialIcons name="close" size={11} color={colors.pillText} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    chip: {
      borderRadius: 14,
      backgroundColor: colors.pillBackground,
      borderColor: colors.pillBorder,
      borderWidth: 1,
      alignSelf: "center",
      // Chips live in a horizontal ScrollView, so nothing else constrains them:
      // a long label (e.g. a Letterboxd list title) would otherwise make one chip
      // wider than the screen and push every other chip out of reach. Kept to
      // about a third of a phone's width: two chips beside it still fit, which
      // is the point of the cap.
      maxWidth: 128,
      // Clipped while its width tweens: the label swaps in one frame but the
      // box takes a moment to catch up, and unclipped text spills past the
      // border on the way.
      overflow: "hidden",
    },
    pressable: {
      flexDirection: "row",
      alignItems: "center",
      // Tight: the row's whole job is to show as many chips at once as it can,
      // and padding is width spent on nothing. The tap target is held up by
      // `hitSlop` above rather than by the padding.
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    chipLabel: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.pillText,
      flexShrink: 1,
    },
  });
