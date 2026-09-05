/**
 * Mobile filter UI component: the Filters button.
 *
 * One component wherever the button appears, and one place too: beside the
 * search field, in `SearchBar`'s `leftSlot`. Every feed and sub-page mounts it
 * the same way, so the same control is never two different sizes — or two
 * different rows — across screens.
 *
 * It stretches to its parent's height when the parent gives it one (the search
 * row lines it up with the search field that way), and stands at its own
 * height otherwise. Corner radius and type size come from the search field
 * itself, so the pair reads as one control strip rather than as two controls
 * that happen to be adjacent.
 *
 * A tap answers with the same glow `PresetButton` uses: a soft-edged pane
 * grows from the middle out to the button's edges, holds there, then clears
 * back to the button's own resting look. Unlike a preset, this button is
 * never "satisfied" — opening the modal doesn't retire it — so the flash has
 * nothing to settle into and simply clears every time.
 */
import { useMemo, type Ref } from "react";
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
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

/** How long the flash takes to grow from the middle to full solid coverage. */
const FLASH_GROW_MS = 110;
/** How long it sits as one solid colour, edge to edge, before it starts to clear. */
const FLASH_HOLD_MS = 60;
/** How long it takes to clear once it starts. */
const FLASH_FADE_MS = 150;
const FLASH_MS = FLASH_GROW_MS + FLASH_HOLD_MS + FLASH_FADE_MS;
/** How wide the flash starts, as a fraction of the button. */
const FLASH_WIDTH_FROM = 0.16;
/**
 * How far the flash's gradient pane overhangs the button on each side, as a
 * fraction of the button's own width — see `PresetButton`'s copy of this for
 * why: it keeps the gradient's soft, near-transparent ends off past the
 * button's clipped edge, so what shows inside is only its gently-tapered
 * middle rather than a hard-edged block.
 */
const FLASH_OVERHANG_FRACTION = 0.18;
const FLASH_OVERHANG = `${FLASH_OVERHANG_FRACTION * 100}%`;
/** The button's own edges, as fractions along the (overhung) gradient pane. */
const BUTTON_EDGE_LOW = FLASH_OVERHANG_FRACTION / (1 + 2 * FLASH_OVERHANG_FRACTION);
const BUTTON_EDGE_HIGH = 1 - BUTTON_EDGE_LOW;
/** The gradient's own shape, as fractions along its (overhung) width. */
const FLASH_GRADIENT_LOCATIONS = [
  0,
  BUTTON_EDGE_LOW - 0.07,
  BUTTON_EDGE_LOW + 0.03,
  BUTTON_EDGE_HIGH - 0.03,
  BUTTON_EDGE_HIGH + 0.07,
  1,
] as const;
/** Alpha bytes to match, on `colors.pillFlashBackground`. */
const FLASH_GRADIENT_ALPHAS = ["00", "80", "ff", "ff", "80", "00"] as const;
/** Where in the flash's own 0-1 timeline it has finished growing. */
const FLASH_GROW_END = FLASH_GROW_MS / FLASH_MS;
/**
 * Where it has gone from invisible to fully opaque — a sliver of the
 * timeline, not a fraction shared with the grow: growing is meant to be
 * seen, appearing from nothing is not.
 */
const FLASH_APPEAR_END = 0.04;
/** Where in that timeline it starts clearing again. */
const FLASH_FADE_START = (FLASH_GROW_MS + FLASH_HOLD_MS) / FLASH_MS;
const FLASH_TIMING = { duration: FLASH_MS, easing: Easing.linear } as const;

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
  const styles = useMemo(() => createStyles(colors), [colors]);
  /** The flash, 0 -> 1 across one press. */
  const flash = useSharedValue(0);

  const flashStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scaleX: interpolate(
          flash.value,
          [0, FLASH_GROW_END, FLASH_FADE_START, 1],
          [FLASH_WIDTH_FROM, 1, 1, 1]
        ),
      },
    ],
    // 0 at rest, not just at the end: `flash` sits at 0 between presses, and
    // without this the idle sliver would sit there fully opaque before
    // anyone has tapped anything.
    opacity: interpolate(flash.value, [0, FLASH_APPEAR_END, FLASH_FADE_START, 1], [0, 1, 1, 0]),
  }));

  const handlePress = () => {
    triggerSelectionHaptic();
    flash.set(0);
    flash.set(withTiming(1, FLASH_TIMING));
    onPress();
  };

  return (
    <TouchableOpacity
      ref={buttonRef}
      style={[styles.button, style]}
      onPress={handlePress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Filters"
    >
      {/* The pane itself overhangs the button (see `FLASH_OVERHANG`) and is
          what scales; `styles.button`'s own `overflow: hidden` is the fixed
          window that clips it, so growing never shrinks the window too. */}
      <Animated.View pointerEvents="none" style={[styles.flashPane, flashStyle]}>
        <LinearGradient
          colors={
            FLASH_GRADIENT_ALPHAS.map(
              (alpha) => `${colors.pillFlashBackground}${alpha}`
            ) as [string, string, ...string[]]
          }
          locations={FLASH_GRADIENT_LOCATIONS as unknown as [number, number, ...number[]]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
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
      // The flash pane is an absolutely positioned sibling of the content,
      // clipped to this radius.
      overflow: "hidden",
    },
    flashPane: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: `-${FLASH_OVERHANG}`,
      right: `-${FLASH_OVERHANG}`,
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
