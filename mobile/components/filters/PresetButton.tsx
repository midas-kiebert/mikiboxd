/**
 * Mobile filter UI component: one saved-preset button.
 *
 * A preset is an action, so the button confirms the tap itself — a small
 * scale pop and a brief lift in its fill — because the change it makes lands
 * in the active-filter row underneath, where the eye is not.
 *
 * All of it is painted in the frame the button is tapped, and none of it waits
 * on anything. The row below answers on its own schedule — it has things to
 * take away before it has things to show — but a control that does not answer
 * a touch immediately reads as a control that missed it, whatever happens
 * afterwards. So this is the button's own animation, on its own clock, and it
 * is kept quiet enough that the row's answer is still the thing you look at:
 * the pop barely leaves the button's own outline, and the lift is one step of
 * the same neutral the chips flash rather than a colour of its own.
 *
 * Reanimated, and specifically *not* React Native's own `Animated`, for one
 * reason that decides the whole file. `Animated.sequence` and `Animated.delay`
 * are orchestrated on the JS thread even under `useNativeDriver: true`: each
 * stage's completion is posted back to JS, and JS starts the next one. A press
 * here fires an apply that re-renders both filter rows and the feed, so the JS
 * thread is busy for exactly as long as the animation is meant to be running,
 * and every handover in it waited for that work to finish. On a mid-range
 * Android phone that came out as pop, shrink, *stall*, pop again, *stall*,
 * flash, snap to disabled — a different shape on every press. Reanimated's
 * `withTiming`/`withSequence`/`withDelay` run start to finish on the UI thread
 * with no JS involvement at all, so a press is the same 250ms whatever else is
 * happening. Nothing in here may go back to a JS-scheduled stage.
 *
 * A press is one closed animation of a fixed length, and nothing interrupts
 * it. The row's verdict on the button — whether it still has anything to
 * apply — arrives in pieces, somewhere in the middle of the press, and letting
 * those pieces drive the animation made a press stop part-way and jump back to
 * lit. The press claims the outcome up front instead (a preset that has just
 * been applied has nothing left to apply) and reconciles with the row once, at
 * the end, in the one case it was wrong.
 *
 * Where it settles back to depends on whether there is anything left to do. A
 * preset that would change nothing stops taking presses — a button that
 * answers a tap by doing nothing is worse than one that says so first — and
 * shows that by fading out rather than by staying lit. The lift belongs to the
 * tap; what it fades into is a greyed-out button.
 *
 * Resting lit would have said the wrong thing: that reads as "this is the one
 * you are on", and a preset can be satisfied while filters it says nothing
 * about are switched on over the top of it — so the only claim it can honestly
 * make is "nothing here left to apply", which is a disabled button and not a
 * selected one.
 *
 * The fade is seeded from `isSatisfied` at construction: a button can mount
 * already satisfied — the favourite preset applied at launch does exactly
 * that — and an animated value is only ever as correct as the last update
 * pushed to the view, which for a state that was never entered is none.
 *
 * The animation lives here, per button, rather than in the row: two presets
 * tapped in quick succession then light up and fade on their own timelines
 * instead of the first being cut off mid-fade by the second.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

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
 * The lift: up in one frame, held just long enough to register as deliberate,
 * then gone. Much shorter than the row's own flash (`filter-change-animation`)
 * and deliberately so — that one has to be *found*, somewhere else on the
 * screen, while this one is under the thumb that caused it and only has to be
 * seen on the way past.
 */
const LIFT_HOLD_MS = 90;
const LIFT_FADE_MS = 160;

/**
 * Tap to settled, end to end. The lift arrives in one frame, so the way back
 * has to be quick too — a long fade off an instant rise reads as the button
 * being slow rather than as one movement.
 *
 * Every part of the press is cut to land on this exactly, so the whole thing
 * is one length and not three that happen to overlap.
 */
const PRESS_MS = LIFT_HOLD_MS + LIFT_FADE_MS;
/** Where in that the lift starts giving way. */
const SETTLE_HANDOVER = LIFT_HOLD_MS / PRESS_MS;

/**
 * What a satisfied button fades back to. In the same range as every other
 * disabled control in the filter UI (0.4–0.5), so it is recognisably the same
 * "not available" and not a look of its own.
 */
const SATISFIED_OPACITY = 0.45;

const POP_UP_MS = 90;
const POP_DOWN_MS = PRESS_MS - POP_UP_MS;
/**
 * How far the button swells at the top of the pop. Small: at 1.05 the swell
 * was the loudest thing in a row whose point is the chips underneath it, and
 * a control only has to move enough to say it was touched.
 *
 * It goes up and comes back on plain curves rather than on a spring. A spring
 * settles when it settles, which is a length the button cannot state, and its
 * overshoot below rest is the first thing to read as a glitch when a frame is
 * dropped.
 */
const POP_SCALE = 1.025;

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
  /** The pop, 0 → 1 → 0 across one press. */
  const pop = useSharedValue(0);
  /** The lift pane's opacity. */
  const lift = useSharedValue(0);
  /** 0 while the button is live, 1 once it has nothing left to apply. */
  const settled = useSharedValue(isSatisfied ? 1 : 0);
  /**
   * When the press in flight, if any, comes to rest.
   *
   * A timestamp rather than a flag with a completion callback: the callback
   * would be the one piece of this that ran on the JS thread, and it would run
   * at the worst possible moment. Nothing has to be cleaned up when a press
   * ends — it simply stops being in the way.
   */
  const pressEndsAt = useRef(0);

  /** Settles the button on the resting look for `satisfied`. */
  const settleOn = useCallback(
    (satisfied: boolean) => {
      settled.value = withTiming(satisfied ? 1 : 0, {
        // One run across the whole press, linear, because the two things it
        // drives take turns rather than move together — see `fillStyle` and
        // `labelStyle`. Easing it would only bend a handover the eye reads as
        // one continuous thing.
        duration: satisfied ? PRESS_MS : LIFT_FADE_MS,
        easing: satisfied ? Easing.linear : Easing.out(Easing.quad),
      });
    },
    [settled]
  );

  // Crossing between the two resting looks: fully there, and faded back.
  useEffect(() => {
    const remaining = pressEndsAt.current - Date.now();
    if (remaining <= 0) {
      settleOn(isSatisfied);
      return;
    }
    // A press is playing, and it is already on its way to the satisfied look.
    // Only a verdict that disagrees has anything to say, and it can say it
    // when the press is over — this timer is a correction, not part of the
    // animation, so it does not matter if a busy thread delivers it late.
    if (isSatisfied) return;
    const timer = setTimeout(() => settleOn(false), remaining);
    return () => clearTimeout(timer);
  }, [isSatisfied, settleOn]);

  const handlePress = () => {
    // A press in flight is not re-entered. The button turns unpressable a
    // moment later anyway — once the row reports it satisfied — and this
    // closes the frame in between, where a second tap would apply twice.
    if (pressEndsAt.current > Date.now()) return;
    pressEndsAt.current = Date.now() + PRESS_MS;
    triggerSelectionHaptic();

    // The whole press, handed to the UI thread in one go. A press always ends
    // disabled — a preset that has just been applied has by definition nothing
    // left to apply — so the button says so on its own rather than waiting to
    // be told, which is what keeps every press identical to every other one.
    pop.value = withSequence(
      withTiming(1, { duration: POP_UP_MS, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: POP_DOWN_MS, easing: Easing.out(Easing.quad) })
    );
    lift.value = withSequence(
      // A frame's ramp rather than a zero-length one, which is a division by
      // the duration away from never finishing. At 1ms it is the same picture.
      withTiming(1, { duration: 1 }),
      withDelay(
        LIFT_HOLD_MS,
        withTiming(0, { duration: LIFT_FADE_MS, easing: Easing.out(Easing.quad) })
      )
    );
    settleOn(true);

    // Next frame, not this one. The apply re-renders both filter rows and the
    // feed; the animations above are already running by then, but the press's
    // first frame should not have to share with that work either.
    requestAnimationFrame(() => onApply(preset));
  };

  const popStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (POP_SCALE - 1) * pop.value }],
  }));
  const liftStyle = useAnimatedStyle(() => ({ opacity: lift.value }));
  // The fill goes first, hidden under the lift, so the lift has somewhere
  // finished to fall into. The label waits for the lift to start leaving:
  // dimming it during the hold is a slow fade with nothing else moving, which
  // is what made the whole thing feel drawn out.
  const fillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      settled.value,
      [0, SETTLE_HANDOVER, 1],
      [1, SATISFIED_OPACITY, SATISFIED_OPACITY]
    ),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(settled.value, [0, SETTLE_HANDOVER, 1], [1, 1, SATISFIED_OPACITY]),
  }));

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
              background: it has to be able to fade behind the lift without
              taking the lift with it. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.pane, styles.fillPane, fillStyle]}
          />
          {/* Over the fill and under the label, so the label stays readable
              while the lift is up. The same neutral the chips flash, so one
              tap reads as one thing even though the two land a beat apart. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.pane, styles.liftPane, liftStyle]}
          />
          <Animated.View style={labelStyle}>
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
      // inside the border, and a lifted pane in a resting outline is not the same
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
    liftPane: {
      backgroundColor: colors.pillFlashBackground,
      borderColor: colors.pillFlashBorder,
    },
    label: {
      fontSize: 13,
      lineHeight: PRESET_BUTTON_TEXT_LINE_HEIGHT,
      fontWeight: "500",
      color: colors.pillText,
    },
  });
