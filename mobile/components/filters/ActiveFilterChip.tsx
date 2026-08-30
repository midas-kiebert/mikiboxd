/**
 * Mobile filter UI component: one active-filter chip.
 *
 * The chip is unchanged — label plus an × that removes only this filter. What
 * it adds is movement: it grows in rather than appearing, fades and dips rather
 * than vanishing, and slides to a new position rather than snapping to one.
 * When a preset is what put it there it arrives wearing the flash, as part of
 * the same entrance rather than as a second thing played over it (see
 * `useChipEntering`); a chip that was already there, untouched, does not.
 *
 * Nothing here decides *when* any of that happens, and nothing here waits to
 * be told anything after it has mounted. The row hands over two booleans about
 * the moment of arrival, both read once; everything that follows from them is
 * a delay inside a Reanimated animation, so none of it can be held up by
 * whatever the JS thread is doing to the feed underneath.
 *
 * Nothing here keeps a removed chip alive either — Reanimated holds it on
 * screen for its exit, which is why the row above can just stop rendering it.
 */
import { useRef } from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import Animated from "react-native-reanimated";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";
import {
  CHIP_LAYOUT_TRANSITION,
  PHASE_ONE_MS,
  chipExiting,
  useChipEntering,
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
  /**
   * True when a preset apply is what put this chip here. Only read at mount:
   * it decides whether the chip arrives wearing the flash.
   */
  flashOnEnter?: boolean;
  /**
   * True when the row still has something to give up. Only read at mount: it
   * decides whether this chip's entrance waits out beat one before playing.
   */
  waitForBeatOne?: boolean;
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
  flashOnEnter = false,
  waitForBeatOne = false,
  onMeasureWidth,
}: ActiveFilterChipProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Frozen at mount. Both describe the moment this chip appeared, and the row
  // goes on changing around it afterwards — a later pass must not be able to
  // rewrite what its arrival was.
  const arrival = useRef({ flash: flashOnEnter, delayMs: waitForBeatOne ? PHASE_ONE_MS : 0 });
  const entering = useChipEntering(arrival.current.flash, arrival.current.delayMs);

  return (
    <Animated.View
      style={styles.chip}
      entering={entering}
      exiting={chipExiting}
      layout={CHIP_LAYOUT_TRANSITION}
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
