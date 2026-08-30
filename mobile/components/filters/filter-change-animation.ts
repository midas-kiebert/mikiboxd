/**
 * How the filter rows answer a change, and how they move while they do.
 *
 * A preset apply is played as two beats, in this order, with nothing shared
 * between them:
 *
 *   1. Everything that goes away, goes — and the cinema pill changes with it.
 *      Chips the preset dropped fade out, the row closes over them, and the
 *      pill morphs its label and resizes to fit it. One window, one duration
 *      (`PHASE_ONE_MS`), and no chip colour anywhere: this beat is
 *      subtraction, and the flash is what the row says about what it has just
 *      been given. (The pill's own flash is the exception — it is already on
 *      screen and starts at once. See `useImmediateFlashTint`.)
 *   2. The moment that window closes: everything the preset added appears —
 *      already wearing the flash, which fades out from under it.
 *
 * Sequencing the two is what keeps them out of each other's way. An arriving
 * chip used to be laid out in the row's *new* shape while the pill was still
 * travelling towards that shape, which drew the two on top of each other for a
 * few frames. Nothing is still moving by the time a chip becomes visible now,
 * so there is nothing left for it to land on — and no compensating offsets
 * anywhere, because the row it appears into is already the row it belongs to.
 *
 * The whole of it is set up in the commit the change lands in, and every wait
 * inside it is a Reanimated delay rather than a timer. That is not a detail:
 * applying a preset also empties and re-renders the feed underneath, and while
 * the JS thread is busy with that, a `setTimeout` boundary drifts hundreds of
 * milliseconds behind the UI-thread animations it is supposed to be following.
 *
 * A chip's flash is part of its entrance and not a second animation played
 * over it. One function describes a chip starting to exist — it grows, it
 * fades in, and it does both wearing the flash colour, which then fades back
 * to the chip's own. There is nothing to line up, because there are not two
 * things. The previous arrangement had the flash on a clock of its own that
 * the chip only started reading once a `setState` had told it to, a commit
 * later, so on a phone with anything else to do the growth finished before the
 * colour had begun — and the chip picked the clock up wherever it had already
 * got to. No part of what a chip does on arrival may depend on a React commit
 * that is not the one it mounted in.
 *
 * Reanimated rather than RN's `Animated` for the row: a chip leaving has to
 * stay on screen after its filter is gone, and the ones beside it have to slide
 * rather than jump — neither is something `Animated` can do.
 *
 * Deliberately plain, after a dust-and-particles version of the exit that did
 * not work: everything here animates one view's own transform, opacity and
 * colour, and nothing coordinates across views at all. Chips flash together
 * because they mount together and are given the same animation, not because
 * anything is holding them in step.
 */
import { useMemo, useRef } from "react";
import {
  Easing,
  LinearTransition,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type EntryExitAnimationFunction,
  type SharedValue,
} from "react-native-reanimated";

import { useThemeColors } from "@/hooks/use-theme-color";

/**
 * Beat one, end to end: how long the row takes to give something up.
 *
 * One number for the whole beat, because the two things in it have to read as
 * one event — the chips the preset dropped fading out, and the cinema pill
 * resizing around its new label. They start together and they finish together;
 * anything else and a preset that both drops a filter and changes the cinemas
 * looks like two things that happened to coincide.
 *
 * It is also the delay before beat two, so it is the whole distance between
 * tapping a preset and seeing what it added. Long enough to read a label morph
 * (a 100ms resize is a snap, not a movement), short enough that the flash
 * still belongs to the tap.
 */
export const PHASE_ONE_MS = 240;

/** Chips slide and resize rather than jumping. Beat one is the only beat that
 * moves anything, so this is the only duration it can have. */
export const CHIP_LAYOUT_TRANSITION = LinearTransition.duration(PHASE_ONE_MS);

/**
 * A chip's label changing is part of beat one like any other resize: the old
 * text slides out sideways as the new text slides in, so the text and the box
 * making room for it travel the same way at the same moment.
 *
 * Exactly the layout transition's duration and curve — anything else and the
 * box visibly trails the text it is widening for.
 */
export const LABEL_MORPH_MS = PHASE_ONE_MS;
/** How far each label travels while it swaps. */
export const LABEL_MORPH_SHIFT = 9;
/** `LinearTransition` is linear, so the label that moves with it must be too. */
export const LABEL_MORPH_EASING = Easing.linear;

/** Beat two: how long an arriving chip takes to settle in. */
const ENTER_MS = 200;

/**
 * How small an arriving chip starts. Near enough to its full size that the
 * growth reads as the chip settling in rather than as an effect played on it:
 * the flash is what says a preset put it there, so the movement only has to be
 * smooth enough not to look like a snap.
 */
const ENTER_SCALE_FROM = 0.94;

/**
 * How far a leaving chip shrinks, and how much it gathers itself up first.
 * `Easing.back` run backwards is that gathering. The shrink goes on the fade,
 * not on the collapse — a chip crushed to nothing draws far more attention
 * than a removal is worth, and the row closing over it already says it is gone.
 */
const EXIT_SCALE = 0.86;
const EXIT_BOUNCE = 1;

/**
 * The flash: painted in one frame, held long enough to find, then released.
 *
 * Length is what carries this, not force — a faint lift that stays put long
 * enough to find is what says which chips a preset is responsible for, and it
 * can do that without ever being the loudest thing on the screen.
 *
 * Not an accent, and deliberately: green read as "this is on", which is a
 * claim about state, and every one of these chips is already on. What the
 * flash has to say is only "this one is new", so it is a step away from the
 * pill's resting colour and nothing more. Which direction that step goes is
 * the theme's to decide — see `pillFlashBackground` in `shared/theme/colors`,
 * where light mode goes down and dark mode goes up.
 */
export const FLASH_HOLD_MS = 260;
export const FLASH_FADE_MS = 380;
export const FLASH_TOTAL_MS = FLASH_HOLD_MS + FLASH_FADE_MS;

/**
 * How long the row is busy, tap to rest: both beats and the flash that closes
 * them. Nothing in here uses it — it is for the screens *around* the row, which
 * have to know how long they have to leave it alone.
 *
 * The row's animations run on the UI thread, but "on the UI thread" only buys
 * immunity from a busy JS thread. Mounting a feed's worth of cards is work the
 * UI thread does itself, and it stalls a running animation exactly the way a
 * blocked JS thread stalls a timer. So a screen that is about to rebuild its
 * feed under a preset apply waits this out first — see `isFilterTransitionLoading`
 * on the home feed, which holds the list empty (and therefore cheap to mount)
 * until the row has stopped.
 *
 * The whole of it rather than just the moving part: the flash is the half most
 * likely to be caught, because it is still running long after everything has
 * come to rest and it looks broken when it stops half-way.
 */
export const FILTER_ROW_SETTLE_MS = PHASE_ONE_MS + FLASH_TOTAL_MS;

/** Paints one pill from the clock it is following. */
function useTintStyle(progress: SharedValue<number>) {
  const colors = useThemeColors();

  const restingFill = colors.pillBackground;
  const restingBorder = colors.pillBorder;
  const flashedFill = colors.pillFlashBackground;
  const flashedBorder = colors.pillFlashBorder;

  return useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [restingFill, flashedFill]),
    borderColor: interpolateColor(progress.value, [0, 1], [restingBorder, flashedBorder]),
  }));
}

/**
 * The same flash, on a clock of the pill's own, painted as soon as it is told
 * to rather than at the beat boundary.
 *
 * For the cinema pill, which is not waiting for anything: it is already on
 * screen, so unlike an arriving chip there is no moment it has to appear at.
 * Whatever it is going to do in beat one it starts doing now, and the flash
 * belongs with that rather than with the arrivals a beat later.
 *
 * Driven by a counter rather than a flag, because two applies in a row are two
 * flashes even when the second says nothing new: a boolean that is still true
 * from the first would leave the second with no edge to fire on. Zero is "not
 * yet", so the pill does not flash on mount.
 *
 * Started here in the render that raises the counter, not from an effect. An
 * effect is a second trip through the JS thread, and the thread is busy with
 * the apply — which is how long the flash would sit waiting to begin. Writing
 * a shared value is not a React state change and has nothing to tear down, so
 * there is nothing for an effect to own.
 */
export function useImmediateFlashTint(flashNonce: number) {
  const own = useSharedValue(0);
  const started = useRef(0);

  if (flashNonce !== started.current) {
    started.current = flashNonce;
    if (flashNonce !== 0) {
      own.value = 1;
      own.value = withDelay(
        FLASH_HOLD_MS,
        withTiming(0, { duration: FLASH_FADE_MS, easing: Easing.inOut(Easing.quad) })
      );
    }
  }

  // At rest the interpolation gives back exactly the pill's own colours, so
  // this can paint unconditionally.
  return useTintStyle(own);
}

/**
 * A chip starting to exist: one animation, from one function, every time.
 *
 * It grows and fades in, and — when a preset is what put it there — it does so
 * wearing the flash, which then fades back to the chip's resting colour. The
 * flash is not a second animation played over the entrance and cannot drift
 * from it, because it is the same animation: same mount, same delay, same
 * clock, described in one place.
 *
 * `delayMs` is beat one, when the row still has something to give up. An
 * arriving chip is mounted in the same commit as everything else — laid out at
 * once, at the end of the row, where it moves nothing — and then *waits
 * invisibly*. `initialValues` land immediately; only the animations are
 * delayed. So for the whole of beat one there is a chip sitting in the row's
 * final layout at zero opacity while its neighbours slide over the top of it,
 * and at the boundary it starts existing with nothing left moving.
 *
 * Waiting this way rather than by mounting late is the point: the delay is a
 * Reanimated one, running on the UI thread. Applying a preset also empties and
 * re-renders the feed underneath, which can hold the JS thread for hundreds of
 * milliseconds — long enough that a `setTimeout` boundary landed the chips
 * well after the pill had finished resizing, while the pill's own animations
 * kept perfect time on the UI thread.
 *
 * Read once, at mount: `entering` is not a live prop, and a chip that has
 * arrived is not arriving again.
 */
export function useChipEntering(flash: boolean, delayMs: number): EntryExitAnimationFunction {
  const colors = useThemeColors();
  const restingFill = colors.pillBackground;
  const restingBorder = colors.pillBorder;
  const flashedFill = colors.pillFlashBackground;
  const flashedBorder = colors.pillFlashBorder;

  return useMemo<EntryExitAnimationFunction>(() => {
    if (!flash) {
      return () => {
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
    }
    // The colour holds while the chip grows and for a moment after, then goes.
    // It outlasts the growth deliberately: the growth says a chip appeared,
    // which is visible anyway, and the flash says a preset is what appeared
    // it — which is a thing the eye has to be given time to find.
    const fadeBack = { duration: FLASH_FADE_MS, easing: Easing.inOut(Easing.quad) };
    return () => {
      "worklet";
      return {
        initialValues: {
          opacity: 0,
          transform: [{ scale: ENTER_SCALE_FROM }],
          backgroundColor: flashedFill,
          borderColor: flashedBorder,
        },
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
          backgroundColor: withDelay(
            delayMs + FLASH_HOLD_MS,
            withTiming(restingFill, fadeBack)
          ),
          borderColor: withDelay(
            delayMs + FLASH_HOLD_MS,
            withTiming(restingBorder, fadeBack)
          ),
        },
      };
    };
  }, [flash, delayMs, restingFill, restingBorder, flashedFill, flashedBorder]);
}

/**
 * Fades out over the whole of beat one, dipping slightly as it goes, while the
 * row closes over it on the same clock. Front-loaded — `Easing.out` — so the
 * chip is faint well before its neighbours reach the space it is vacating.
 */
export const chipExiting: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: PHASE_ONE_MS, easing: Easing.out(Easing.quad) }),
      transform: [
        {
          scale: withTiming(EXIT_SCALE, {
            duration: PHASE_ONE_MS,
            easing: Easing.in(Easing.back(EXIT_BOUNCE)),
          }),
        },
      ],
    },
  };
};
