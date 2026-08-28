/**
 * Mobile filter UI component: one saved-preset button.
 *
 * A preset is an action, so the button confirms the tap itself — with a tint
 * in the green accent trio and a short scale pop — because the change it makes
 * lands in the active-filter row underneath, where the eye is not.
 *
 * Where it settles back to depends on whether there is anything left to do. A
 * preset that would change nothing keeps the green and stops taking presses:
 * pressing it again is a no-op, and a button that answers a tap by doing
 * nothing is worse than one that says so first. It is the same green the tap
 * flashes, so the two read as one thing — the tap turning into a state — and
 * it leaves as soon as a filter moves out from under it.
 *
 * Being done is also being unavailable, so it has to look unavailable: the
 * green is held back from full strength and a tick takes the place of the
 * press it will not answer. Colour alone would only say "this one", which is
 * what a live button says too.
 *
 * That resting green is a plain style, not an animated value. An animated
 * colour is only ever as correct as the last update pushed to the view, and a
 * button that mounts already satisfied — the favourite preset applied at
 * launch does exactly that — has no update to be pushed. What animates is one
 * green pane on top of the button, which is all a fade needs to be.
 *
 * The animation lives here, per button, rather than in the row: two presets
 * tapped in quick succession then light up and fade on their own timelines
 * instead of the first being cut off mid-fade by the second.
 */
import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, TouchableOpacity, View } from "react-native";
import Reanimated, {
  Easing as ReanimatedEasing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { type DisplayPreset } from "@/components/filters/saved-presets";
import {
  PRESET_BUTTON_PADDING_VERTICAL,
  PRESET_BUTTON_RADIUS,
  PRESET_BUTTON_TEXT_LINE_HEIGHT,
} from "@/components/filters/filter-control-metrics";
import { triggerSelectionHaptic } from "@/utils/long-press";

/**
 * Deliberately quicker than the chips this button changes (see
 * `filter-change-animation`): confirming a tap the user just made needs only
 * to be felt, while the chips have to be found somewhere else on the screen
 * before they can be read.
 */
const TINT_HOLD_MS = 260;
const TINT_FADE_OUT_MS = 160;

/**
 * The tick is a slot that opens and closes rather than an icon that appears
 * and disappears: mounting it outright changes the button's width in one
 * frame, and every button to the right of it jumps by the same amount. A
 * preset that stops being satisfied because a *different* one was tapped has
 * nothing else moving to hide that jump.
 */
const CHECK_ICON_SIZE = 12;
/** Between the tick and the label, and part of what the slot opens by. */
const CHECK_ICON_GAP = 4;
const CHECK_SLOT_WIDTH = CHECK_ICON_SIZE + CHECK_ICON_GAP;
const CHECK_REVEAL_MS = TINT_FADE_OUT_MS;
const CHECK_REVEAL_EASING = ReanimatedEasing.out(ReanimatedEasing.quad);

const POP_UP_MS = 90;
/** How far the button swells at the top of the pop. */
const POP_SCALE = 1.05;


const LONG_PRESS_DELAY_MS = 300;

type PresetButtonProps = {
  preset: DisplayPreset;
  /** True while applying this preset would leave every filter as it is. */
  isSatisfied: boolean;
  onApply: (preset: DisplayPreset) => void;
  onLongPress: (preset: DisplayPreset) => void;
};

export default function PresetButton({
  preset,
  isSatisfied,
  onApply,
  onLongPress,
}: PresetButtonProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // The green pane's opacity, and the scale. Both run natively now that no
  // colour is interpolated.
  const flash = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  /**
   * How far the tick's slot is open — and so, since the label sits after it,
   * where the label is.
   *
   * Reanimated rather than the `Animated` above, because this one drives a
   * *width*: the label only moves if layout runs, and layout driven from JS
   * lands a commit late every frame, which the eye reads as the text lagging
   * behind and then catching up at the end. Reanimated writes the width from
   * the UI thread, where the layout it causes happens in the same frame.
   *
   * Started at its resting position rather than at zero, because a button can
   * mount already satisfied — the favourite preset applied at launch does
   * exactly that — and there is nothing to animate about a state that was
   * never entered.
   */
  const checkOpen = useSharedValue(isSatisfied ? 1 : 0);
  const checkSlotStyle = useAnimatedStyle(() => ({
    width: CHECK_SLOT_WIDTH * checkOpen.value,
    opacity: checkOpen.value,
  }));
  /**
   * The press animation, held so it can be called off.
   *
   * Stopping the *value* is not enough: the press schedules a hold and then a
   * fade, and during the hold there is nothing running on the value to stop —
   * the fade starts later and pulls the button back to grey whatever anyone
   * did in the meantime.
   */
  const pressAnimation = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(
    () => () => {
      pressAnimation.current?.stop();
      flash.stopAnimation();
      pop.stopAnimation();
    },
    [flash, pop]
  );

  // Crossing between the two resting looks. The button itself has already
  // changed colour by the time this runs — that is a style, and it lands with
  // the render — so all this does is hold the *old* look on top for as long as
  // the change deserves.
  const wasSatisfied = useRef(isSatisfied);
  useEffect(() => {
    if (wasSatisfied.current === isSatisfied) return;
    wasSatisfied.current = isSatisfied;
    pressAnimation.current?.stop();
    flash.stopAnimation();
    // Replaces whatever was running on it, so a preset flipped twice in quick
    // succession picks up from wherever the slot had got to.
    checkOpen.value = withTiming(isSatisfied ? 1 : 0, {
      duration: CHECK_REVEAL_MS,
      easing: CHECK_REVEAL_EASING,
    });
    if (isSatisfied) {
      // Green underneath now, so the pane has nothing left to say — but it is
      // the full-strength green and the button beneath it is the held-back
      // one, so it is faded rather than dropped. The flash never ends; it
      // settles.
      Animated.timing(flash, {
        toValue: 0,
        duration: TINT_FADE_OUT_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      return;
    }
    // Green a moment ago. Keep it up, then let it go.
    flash.setValue(1);
    Animated.timing(flash, {
      toValue: 0,
      duration: TINT_FADE_OUT_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [isSatisfied, flash, checkOpen]);

  const handlePress = () => {
    triggerSelectionHaptic();
    // Painted before the apply, which re-renders both filter rows: the button
    // has to answer the tap ahead of that work, not after it.
    pressAnimation.current?.stop();
    flash.stopAnimation();
    pop.stopAnimation();
    flash.setValue(1);
    pop.setValue(0);
    pressAnimation.current = Animated.parallel([
      Animated.sequence([
        Animated.delay(TINT_HOLD_MS),
        Animated.timing(flash, {
          toValue: 0,
          duration: TINT_FADE_OUT_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(pop, {
          toValue: 1,
          duration: POP_UP_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(pop, {
          toValue: 0,
          friction: 5,
          tension: 140,
          useNativeDriver: true,
        }),
      ]),
    ]);
    pressAnimation.current.start();
    onApply(preset);
  };

  const popStyle = {
    transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, POP_SCALE] }) }],
  };

  return (
    // The touchable wraps the animated view rather than the other way around,
    // so the press dims the whole button and not just its label.
    //
    // Long-press survives being satisfied: that gesture deletes the preset,
    // which is exactly as available whether or not it has anything to apply.
    <TouchableOpacity
      onPress={isSatisfied ? undefined : handlePress}
      onLongPress={() => onLongPress(preset)}
      delayLongPress={LONG_PRESS_DELAY_MS}
      activeOpacity={isSatisfied ? 1 : 0.8}
      accessibilityRole="button"
      accessibilityState={{ disabled: isSatisfied }}
      accessibilityHint={isSatisfied ? "Already applied" : undefined}
    >
      {/* The scale on its own wrapper, so the button underneath is an
          ordinary view whose colours are ordinary styles. */}
      <Animated.View style={popStyle}>
        <View style={[styles.button, isSatisfied && styles.buttonSatisfied]}>
          {/* Over the whole button, border included, and under the label —
              which is why it is drawn first. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.flashPane, { opacity: flash }]}
          />
          {/* Always mounted, so what changes is how much room it takes. */}
          <Reanimated.View pointerEvents="none" style={[styles.checkSlot, checkSlotStyle]}>
            <View style={styles.checkSlotInner}>
              <MaterialIcons name="check" size={CHECK_ICON_SIZE} color={colors.pillText} />
            </View>
          </Reanimated.View>
          <ThemedText style={styles.label} numberOfLines={1}>
            {preset.name}
          </ThemedText>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    button: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 13,
      paddingVertical: PRESET_BUTTON_PADDING_VERTICAL,
      borderRadius: PRESET_BUTTON_RADIUS,
      borderWidth: 1,
      backgroundColor: colors.pillBackground,
      borderColor: colors.pillBorder,
    },
    buttonSatisfied: {
      backgroundColor: colors.green.primary,
      borderColor: colors.green.border,
      // Short of full strength, which is what the tap flashes: lit, but
      // plainly not waiting to be pressed.
      opacity: 0.65,
    },
    checkSlot: {
      // Clipped, so the tick is cut away by the closing slot rather than
      // squashed by it.
      overflow: "hidden",
      justifyContent: "center",
    },
    checkSlotInner: {
      width: CHECK_SLOT_WIDTH,
      // Never squeezed to fit the slot that is clipping it.
      flexShrink: 0,
      flexDirection: "row",
      alignItems: "center",
    },
    flashPane: {
      position: "absolute",
      // Out by the border width on every side: an absolute child is laid out
      // inside the border, and a green pane in a grey outline is not the same
      // button.
      top: -1,
      left: -1,
      right: -1,
      bottom: -1,
      borderRadius: PRESET_BUTTON_RADIUS,
      borderWidth: 1,
      backgroundColor: colors.green.primary,
      borderColor: colors.green.border,
    },
    label: {
      fontSize: 13,
      lineHeight: PRESET_BUTTON_TEXT_LINE_HEIGHT,
      fontWeight: "500",
      color: colors.pillText,
    },
  });
