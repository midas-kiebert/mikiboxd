/**
 * Mobile filter UI component: one saved-preset button.
 *
 * A preset is an action, so the button confirms the tap itself: a band of
 * light flashing out of its middle to both edges, the same movement the
 * bottom tab bar answers a press with (`components/tab-bar.tsx`). The change
 * a preset makes lands in the active-filter row underneath, where the eye is
 * not, so the button has to answer on its own — but it says so with light
 * alone, not with a size change, since the row below is the thing meant to
 * move.
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
 * with no JS involvement at all, so a press is the same length whatever else is
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
 * shows that by fading out rather than by staying lit. The flash still belongs
 * to the tap; what it fades into is a greyed-out button.
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
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { type DisplayPreset } from "@/components/filters/saved-presets";
import {
  PRESET_BUTTON_PADDING_VERTICAL,
  PRESET_BUTTON_RADIUS,
  PRESET_BUTTON_TEXT_LINE_HEIGHT,
} from "@/components/filters/filter-control-metrics";
import { triggerSelectionHaptic } from "@/utils/long-press";

/** How long the flash takes to grow from the middle to full solid coverage. */
const FLASH_GROW_MS = 110;
/** How long it sits as one solid colour, edge to edge, before it starts to clear. */
const FLASH_HOLD_MS = 60;
/**
 * How long the flash takes to clear once it starts — which is also how long
 * the button takes to dim to its settled look, since that is what clearing
 * the flash reveals. The two finish in the same frame by construction.
 */
const FLASH_FADE_MS = 150;
/** Tap to settled, end to end. */
const PRESS_MS = FLASH_GROW_MS + FLASH_HOLD_MS + FLASH_FADE_MS;
/** How wide the flash starts, as a fraction of the button. */
const FLASH_WIDTH_FROM = 0.16;
/**
 * How far the flash's gradient pane overhangs the button on each side, as a
 * fraction of the button's own width. A straight-edged rectangle read as a
 * mechanical wipe; the edge has to soften into the background instead of
 * cutting against it, like light falling off rather than a shape sliding in.
 * The soft, near-transparent ends of the gradient below land out here, past
 * the clipped edge, so what is left inside the button is the gradient's
 * bright, only-gently-tapered middle — full-looking at rest, without a hard
 * line anywhere.
 */
const FLASH_OVERHANG_FRACTION = 0.18;
const FLASH_OVERHANG = `${FLASH_OVERHANG_FRACTION * 100}%`;
/**
 * The button's own edges, expressed as fractions along the (overhung)
 * gradient pane — the maths behind `FLASH_OVERHANG`: a pane overhanging by
 * that fraction on each side puts the button's visible left/right edges at
 * `overhang / (1 + 2 * overhang)` and its mirror.
 */
const BUTTON_EDGE_LOW = FLASH_OVERHANG_FRACTION / (1 + 2 * FLASH_OVERHANG_FRACTION);
const BUTTON_EDGE_HIGH = 1 - BUTTON_EDGE_LOW;
/**
 * The gradient's own shape, as fractions along its (overhung) width. Reaches
 * solid *just* inside the button's real edges (`BUTTON_EDGE_LOW/HIGH` above),
 * so almost the entire button reads as one flat colour and only a thin sliver
 * right at the border is still visibly soft — the transparent tails stay out
 * in the overhang, never inside the button at all.
 */
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
const FLASH_GROW_END = FLASH_GROW_MS / PRESS_MS;
/**
 * Where it has gone from invisible to fully opaque — a sliver of the
 * timeline, not a fraction shared with the grow: growing is meant to be
 * seen, appearing from nothing is not.
 */
const FLASH_APPEAR_END = 0.04;
/** Where in that timeline it starts clearing again. */
const FLASH_FADE_START = (FLASH_GROW_MS + FLASH_HOLD_MS) / PRESS_MS;
const FLASH_TIMING = { duration: PRESS_MS, easing: Easing.linear } as const;

/**
 * The dim is not a separate move: it starts exactly when the flash starts
 * clearing and finishes exactly when the flash is gone, so what the flash
 * reveals as it clears already is the settled look underneath.
 */
const DIM_DELAY_MS = FLASH_GROW_MS + FLASH_HOLD_MS;
const DIM_MS = FLASH_FADE_MS;

/**
 * What a satisfied button fades back to. In the same range as every other
 * disabled control in the filter UI (0.4-0.5), so it is recognisably the same
 * "not available" and not a look of its own.
 */
const SATISFIED_OPACITY = 0.45;

/**
 * How long the settled look takes to let go, on the rare correction where a
 * press claimed satisfied but the row disagreed once it caught up.
 */
const UNSETTLE_FADE_MS = 160;

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
  /** The flash, 0 -> 1 across one press. */
  const flash = useSharedValue(0);
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
      if (satisfied) {
        // Held off until the flash has already opened out and started
        // clearing — see `DIM_DELAY_MS` — so the dim never reads as the thing
        // that cut the flash short.
        settled.set(
          withDelay(
            DIM_DELAY_MS,
            withTiming(1, { duration: DIM_MS, easing: Easing.out(Easing.quad) })
          )
        );
        return;
      }
      // A correction, not part of the choreography above: whatever is
      // playing just needs to let go of the satisfied look, right away.
      settled.set(
        withTiming(0, {
          duration: UNSETTLE_FADE_MS,
          easing: Easing.out(Easing.quad),
        })
      );
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
    flash.set(0);
    flash.set(withTiming(1, FLASH_TIMING));
    settleOn(true);

    // Next frame, not this one. The apply re-renders both filter rows and the
    // feed; the animation above is already running by then, but the press's
    // first frame should not have to share with that work either.
    requestAnimationFrame(() => onApply(preset));
  };

  // Narrow in the middle of the button at the start, growing out to the
  // edges. The pane itself overhangs the button (see `FLASH_OVERHANG`), so
  // this only ever scales its already-soft ends further out of view — the
  // edges the button actually shows are the gradient's midsection, not its
  // hard-clipped boundary.
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
    // without this the idle sliver at `FLASH_WIDTH_FROM` would sit there
    // fully opaque before anyone has tapped anything.
    opacity: interpolate(flash.value, [0, FLASH_APPEAR_END, FLASH_FADE_START, 1], [0, 1, 1, 0]),
  }));
  // Fill and label dim together, on the one delayed clock above — nothing to
  // stagger here now that the dim only ever starts once the flash is done.
  const fillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(settled.value, [0, 1], [1, SATISFIED_OPACITY]),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(settled.value, [0, 1], [1, SATISFIED_OPACITY]),
  }));

  return (
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
      <View style={styles.button}>
        {/* The button itself, as a layer rather than as the box's own
            background: it has to be able to fade behind the flash without
            taking the flash with it. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.pane, styles.fillPane, fillStyle]}
        />
        {/* Over the fill and under the label, so the label stays readable
            as the flash grows under it. `flashClip` is the button's own
            static shape and never itself animates; `flashPane` inside it is
            wider than the button and is what scales, so the clip acts as a
            fixed window onto it rather than shrinking along with it. */}
        <View pointerEvents="none" style={[styles.pane, styles.flashClip]}>
          <Animated.View style={[styles.flashPane, flashStyle]}>
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
        </View>
        <Animated.View style={labelStyle}>
          <ThemedText style={styles.label} numberOfLines={1}>
            {preset.name}
          </ThemedText>
        </Animated.View>
      </View>
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
    flashClip: {
      borderColor: "transparent",
      overflow: "hidden",
    },
    flashPane: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: `-${FLASH_OVERHANG}`,
      right: `-${FLASH_OVERHANG}`,
    },
    label: {
      fontSize: 13,
      lineHeight: PRESET_BUTTON_TEXT_LINE_HEIGHT,
      fontWeight: "500",
      color: colors.pillText,
    },
  });
