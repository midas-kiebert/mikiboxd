/**
 * Mobile filter UI component: one saved-preset button.
 *
 * A preset is an action, so the button confirms the tap itself — with a tint
 * in the green accent trio and a short scale pop — because the change it makes
 * lands in the active-filter row underneath, where the eye is not.
 *
 * Where it settles back to depends on whether there is anything left to do. A
 * preset that would change nothing stops taking presses — a button that
 * answers a tap by doing nothing is worse than one that says so first — and
 * shows that by fading out rather than by staying lit. The green belongs to
 * the tap; what it fades into is a greyed-out button.
 *
 * Resting on the green would have said the wrong thing. Green reads as "this
 * is the one you are on", and a preset can be satisfied while filters it says
 * nothing about are switched on over the top of it — so the only claim it can
 * honestly make is "nothing here left to apply", which is a disabled button
 * and not a selected one.
 *
 * The fade is an opacity, seeded from `isSatisfied` at construction: a button
 * can mount already satisfied — the favourite preset applied at launch does
 * exactly that — and an animated value is only ever as correct as the last
 * update pushed to the view, which for a state that was never entered is
 * none.
 *
 * The animation lives here, per button, rather than in the row: two presets
 * tapped in quick succession then light up and fade on their own timelines
 * instead of the first being cut off mid-fade by the second.
 */
import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, TouchableOpacity, View } from "react-native";

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
const TINT_HOLD_MS = 130;
const TINT_FADE_OUT_MS = 130;

/**
 * Tap to settled, end to end. The green arrives in one frame, so the way back
 * has to be quick too — a long fade off an instant rise reads as the button
 * being slow rather than as one movement.
 */
const SETTLE_MS = TINT_HOLD_MS + TINT_FADE_OUT_MS;
/** Where in that the green starts giving way. */
const SETTLE_HANDOVER = TINT_HOLD_MS / SETTLE_MS;

/**
 * What a satisfied button fades back to. In the same range as every other
 * disabled control in the filter UI (0.4–0.5), so it is recognisably the same
 * "not available" and not a look of its own.
 */
const SATISFIED_OPACITY = 0.45;

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
  /** 0 while the button is live, 1 once it has nothing left to apply. */
  const dim = useRef(new Animated.Value(isSatisfied ? 1 : 0)).current;
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
      dim.stopAnimation();
    },
    [flash, pop, dim]
  );

  // Crossing between the two resting looks: fully there, and faded back.
  const wasSatisfied = useRef(isSatisfied);
  useEffect(() => {
    if (wasSatisfied.current === isSatisfied) return;
    wasSatisfied.current = isSatisfied;
    dim.stopAnimation();
    if (isSatisfied) {
      // One run across the whole settle, linear, because the two things it
      // drives take turns rather than move together — see `dimStyle` and
      // `labelDimStyle`. Easing it would only bend a handover the eye reads
      // as one continuous thing.
      Animated.timing(dim, {
        toValue: 1,
        duration: SETTLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
      return;
    }
    // There is something to apply again. Any green still up belongs to a tap
    // that has just been overtaken, so it goes with it.
    pressAnimation.current?.stop();
    flash.stopAnimation();
    Animated.parallel([
      Animated.timing(flash, {
        toValue: 0,
        duration: TINT_FADE_OUT_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(dim, {
        toValue: 0,
        duration: TINT_FADE_OUT_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [isSatisfied, flash, dim]);

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
  // The fill goes first, hidden under the green, so the green has somewhere
  // finished to fall into. The label waits for the green to start leaving:
  // dimming it during the hold is a slow fade with nothing else moving, which
  // is what made the whole thing feel drawn out.
  const dimStyle = {
    opacity: dim.interpolate({
      inputRange: [0, SETTLE_HANDOVER, 1],
      outputRange: [1, SATISFIED_OPACITY, SATISFIED_OPACITY],
    }),
  };
  const labelDimStyle = {
    opacity: dim.interpolate({
      inputRange: [0, SETTLE_HANDOVER, 1],
      outputRange: [1, 1, SATISFIED_OPACITY],
    }),
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
      {/* The scale on a wrapper of its own, so what it holds can be flat
          layers stacked back to front. */}
      <Animated.View style={popStyle}>
        <View style={styles.button}>
          {/* The button itself, as a layer rather than as the box's own
              background: it has to be able to fade behind the green without
              taking the green with it. */}
          <Animated.View pointerEvents="none" style={[styles.pane, styles.fillPane, dimStyle]} />
          {/* Over the fill and under the label, so the label stays readable
              while the green is up. */}
          <Animated.View pointerEvents="none" style={[styles.pane, styles.flashPane, { opacity: flash }]} />
          <Animated.View style={labelDimStyle}>
            <ThemedText style={styles.label} numberOfLines={1}>
              {preset.name}
            </ThemedText>
          </Animated.View>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    // Nothing but the box: the padding and the space the border takes up. Its
    // border is kept, transparent, so the button is exactly as tall as it
    // always was (see `PRESET_BUTTON_HEIGHT`).
    button: {
      paddingHorizontal: 13,
      paddingVertical: PRESET_BUTTON_PADDING_VERTICAL,
      borderRadius: PRESET_BUTTON_RADIUS,
      borderWidth: 1,
      borderColor: "transparent",
    },
    pane: {
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
    },
    fillPane: {
      backgroundColor: colors.pillBackground,
      borderColor: colors.pillBorder,
    },
    flashPane: {
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
