/**
 * How the filter chips react to a change, and how they move while they do.
 *
 * Applying a preset can rewrite several filters at once, and the result lands
 * in a row the eye is not on. These animations say which chips it touched and
 * how — one added, one dropped, one rewritten in place — and leave every
 * untouched chip completely still, since the point is the difference, not the
 * row.
 *
 * Two separate things, deliberately:
 *   - *Motion* (entering, leaving, sliding to a new position) runs for every
 *     change, including the user removing a chip by hand. A chip that snaps
 *     from one place to another is the thing that makes a row hard to follow.
 *   - *Colour* runs only for a chip a preset brought in, which is the one
 *     thing motion alone cannot say: everything else was already there.
 *
 * Reanimated rather than RN's `Animated`: a chip leaving has to stay on screen
 * after its filter is gone, and the ones beside it have to slide rather than
 * jump — neither is something `Animated` can do.
 *
 * Deliberately plain, after a dust-and-particles version of the exit that did
 * not work: everything here animates one view's own transform and opacity,
 * with nothing coordinating across views or outliving its own animation.
 */
import { useEffect } from "react";
import {
  Easing,
  LinearTransition,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type EntryExitAnimationFunction,
} from "react-native-reanimated";

import { useThemeColors } from "@/hooks/use-theme-color";

/**
 * Slow enough to read. These are longer than the preset button's own flash
 * (see `PresetButton`): that one confirms a tap the user just made and can be
 * brief, while this one has to be noticed somewhere else on the screen first.
 *
 * Length is what carries this, not force — a faint tint that stays put long
 * enough to find is what links the chip back to the button that was tapped,
 * and it can do that without ever being the loudest thing on the screen.
 */
const TINT_HOLD_MS = 260;
const TINT_FADE_MS = 380;

/**
 * How long a chip must be told it changed. Cutting the prop before this is up
 * snaps the tint off mid-fade, which is the one thing the slow fade exists to
 * avoid.
 */
export const CHANGE_HIGHLIGHT_MS = TINT_HOLD_MS + TINT_FADE_MS;

/** How long a chip takes to slide, and to resize, into a new layout. */
const LAYOUT_MS = 240;

/**
 * Exported for anything driven outside Reanimated that has to finish when the
 * chip around it does — the cinema pill's caret spins on RN's `Animated` and
 * would otherwise settle before the pill it sits in has stopped resizing.
 */
export const CHIP_LAYOUT_MS = LAYOUT_MS;

/**
 * A chip's label changing is a change like any other, so it is animated like
 * one: the old text slides out sideways as the new text slides in. Sideways
 * rather than up and down so the two read as one movement — the chip widening
 * and its label travelling the same way at the same moment.
 *
 * Exactly the layout transition's duration, and run on its curve (below), for
 * the same reason: anything else and the box visibly trails the text it is
 * making room for.
 */
export const LABEL_MORPH_MS = LAYOUT_MS;
/** How far each label travels while it swaps. */
export const LABEL_MORPH_SHIFT = 9;

/** `LinearTransition` is linear, so the label that moves with it must be too. */
export const LABEL_MORPH_EASING = Easing.linear;

const ENTER_MS = 200;

/**
 * How small an arriving chip starts. Near enough to its full size that the
 * growth reads as the chip settling in rather than as an effect played on it:
 * the tint is what says a preset put it there, so the movement only has to be
 * smooth enough not to look like a snap.
 */
const ENTER_SCALE_FROM = 0.94;

/**
 * Exported so the row can hold everything else still for exactly this long.
 *
 * Shorter than the entrance on purpose: an arriving chip is something to look
 * at, a leaving one is already answered by the tap that removed it, and every
 * other chip in the row is waiting on this before it may move.
 *
 * And short enough that the arrivals it holds back still land inside the
 * preset button's own flash (`PresetButton`, 130ms green then 130ms fading):
 * nothing may move into a leaving chip's place before it is gone, so this
 * window is the whole distance between tapping a preset and seeing the row
 * answer. At 170 the row started moving as the button finished, which read as
 * two separate events rather than one.
 */
export const CHIP_EXIT_MS = 100;
const EXIT_MS = CHIP_EXIT_MS;

/**
 * Barely any on the way out. `Easing.back` run backwards makes a leaving chip
 * gather itself up before it goes; at the entrance's strength, over a window
 * this short, that swell is the only part the eye catches.
 */
const EXIT_BOUNCE = 1;

/**
 * How far a leaving chip shrinks. It goes on the fade, not on the collapse —
 * a chip crushed to nothing draws far more attention than the removal is
 * worth, and the row closing over it already says the chip is gone.
 */
const EXIT_SCALE = 0.86;

/** Chips slide to a new position rather than appearing at it. */
export const CHIP_LAYOUT_TRANSITION = LinearTransition.duration(LAYOUT_MS);

/**
 * The same slide, held back until the chips that are leaving have finished
 * leaving.
 *
 * Reanimated takes a removed chip out of the layout the moment it is
 * unmounted and draws it in place while it plays its exit — so the chips
 * beside it are free to slide straight through the space it is still
 * occupying. Applying a preset can remove several at once, which is where that
 * was visible as chips overlapping each other. Nothing may move into a chip's
 * place until the chip is actually gone.
 */
export const CHIP_LAYOUT_AFTER_EXIT = LinearTransition.duration(LAYOUT_MS).delay(EXIT_MS);

/**
 * Only an arriving chip gets anything of its own, and only a green tint: it is
 * the one that was not there to be looked at a moment ago. A chip whose value
 * was rewritten is already in place and already moving — its width changes and
 * its label slides across — and a swell on top of that fought the resize
 * whenever the new value was the shorter one.
 */
const ADDED_ACCENT = "green" as const;

/**
 * How far from the chip's resting colour a tint travels. The accents are
 * designed as fills for a whole card, and at full strength on something this
 * small they shout; part of the way there still reads as "this one".
 */
const FILL_STRENGTH = 0.34;
const BORDER_STRENGTH = 0.5;

const parseHex = (color: string): [number, number, number] | null => {
  if (!color.startsWith("#")) return null;
  const raw = color.slice(1);
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : raw;
  if (full.length !== 6) return null;
  const value = Number.parseInt(full, 16);
  if (Number.isNaN(value)) return null;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/** Blends two theme colours, so a tint can stop short of the full accent. */
export const mixColors = (from: string, to: string, amount: number): string => {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) return to;
  const channel = (index: number) => Math.round(a[index] + (b[index] - a[index]) * amount);
  return `#${[0, 1, 2]
    .map((index) => channel(index).toString(16).padStart(2, "0"))
    .join("")}`;
};

/**
 * The tint a chip shows when a preset brought it in. Returns one animated
 * style for the chip's own view.
 */
export function useAddedChipTint(isAdded: boolean) {
  const colors = useThemeColors();
  const tint = useSharedValue(0);

  const accent = colors[ADDED_ACCENT];
  const restingFill = colors.pillBackground;
  const restingBorder = colors.pillBorder;
  const tintedFill = mixColors(restingFill, accent.primary, FILL_STRENGTH);
  const tintedBorder = mixColors(restingBorder, accent.border, BORDER_STRENGTH);

  useEffect(() => {
    if (!isAdded) {
      tint.value = 0;
      return;
    }
    // Painted at once, held long enough to find, then released: a tint that
    // snaps back reads as a glitch rather than as a change.
    tint.value = 1;
    tint.value = withDelay(
      TINT_HOLD_MS,
      withTiming(0, { duration: TINT_FADE_MS, easing: Easing.inOut(Easing.quad) })
    );
  }, [isAdded, tint]);

  // Nothing at all is written unless this chip is actually being tinted: the
  // exit animates the chip's own colours and transform, and an animated style
  // still claiming those properties would be arguing with it.
  return useAnimatedStyle(() => {
    if (!isAdded) return {};
    return {
      backgroundColor: interpolateColor(tint.value, [0, 1], [restingFill, tintedFill]),
      borderColor: interpolateColor(tint.value, [0, 1], [restingBorder, tintedBorder]),
    };
  });
}

/**
 * Grows in rather than appearing at full size. Held back by the same delay
 * as the slide when other chips are on their way out: an arriving chip drawn
 * at its final position, before the row has closed up, is the other way two
 * chips end up on top of each other. It waits invisibly — `initialValues` are
 * applied at once, the animations are what is delayed.
 */
const makeChipEntering =
  (delayMs: number): EntryExitAnimationFunction =>
  () => {
    "worklet";
    return {
      initialValues: { opacity: 0, transform: [{ scale: ENTER_SCALE_FROM }] },
      animations: {
        opacity: withDelay(delayMs, withTiming(1, { duration: ENTER_MS * 0.7 })),
        transform: [
          {
            scale: withDelay(
              delayMs,
              withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) })
            ),
          },
        ],
      },
    };
  };

export const chipEntering = makeChipEntering(0);
export const chipEnteringAfterExit = makeChipEntering(EXIT_MS);

/**
 * Fades out, dipping very slightly as it goes. Most of the reading is in the
 * opacity — front-loaded, so the chip is out of the way well before the
 * animation formally ends and the row closes up behind it.
 */
export const chipExiting: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: EXIT_MS, easing: Easing.out(Easing.quad) }),
      transform: [
        {
          scale: withTiming(EXIT_SCALE, {
            duration: EXIT_MS,
            easing: Easing.in(Easing.back(EXIT_BOUNCE)),
          }),
        },
      ],
    },
  };
};
