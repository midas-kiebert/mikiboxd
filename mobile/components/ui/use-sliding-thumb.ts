/**
 * The motion behind a segmented control: one thumb that travels to the segment
 * you picked instead of appearing on it.
 *
 * Shared by every either/or control in the app so they all move the same way —
 * `SegmentedControl` and the per-friend visibility control, which cannot share
 * a component (different shape, different palette) but must share a feel.
 *
 * Segments are measured rather than assumed equal: labels differ in width, so
 * the thumb resizes on the way as well as moving. Until the first measurement
 * lands the thumb is transparent, and it takes its opening position without
 * animating — a control must never be seen sliding into place on mount.
 *
 * The travel is started by the press itself (`moveTo`), not by React noticing
 * the value afterwards. Nothing about how far along the thumb is may depend on
 * what the press set in motion: on the Friends tab the same tap swaps a
 * SectionList for a FlatList and renders a QR code, and a tween that waited for
 * the effect after that commit started visibly late. Once `moveTo` has handed
 * the tween to the UI thread there is nothing left on the JS thread to block.
 *
 * A control that sits above a pager passes an `externalProgress` instead, and
 * then none of that applies: the thumb stops being something moved *to* a
 * segment and becomes a readout of where the pages are, following a shared
 * value that the pan gesture writes. It tracks the finger mid-drag for free,
 * and — the reason it exists — it never waits on React. Committing a page
 * change re-renders a whole screen of feed content, and on Android that commit
 * ran for a second or more after the swipe was over, with the thumb still
 * sitting on the page the user had left. Nothing on this path touches the JS
 * thread, so nothing can hold it up.
 *
 * The reconciliation pass below is for the value changing from somewhere other
 * than a press (a deep link, a rejected write reverting). It is a layout effect
 * rather than a passive one for the same reason, and it costs nothing after a
 * press: `appliedRef` records where the thumb was last sent, and sending it
 * where it is already going is a no-op rather than a restarted tween.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type DerivedValue,
  type SharedValue,
} from "react-native-reanimated";

/** One travel of the thumb, and the crossfade of the labels it passes. */
export const THUMB_SLIDE_MS = 220;
export const THUMB_SLIDE_EASING = Easing.out(Easing.cubic);

/** How long after a travel should have ended before it is checked. */
const SETTLE_GRACE_MS = 80;
/** Sub-pixel slack, so a float that landed exactly is never "wrong". */
const SETTLE_EPSILON = 0.01;

export type SegmentLayout = { x: number; width: number };

export type SlidingThumb = {
  /** Hand every segment's `onLayout` to this, with its index. */
  onSegmentLayout: (index: number, event: LayoutChangeEvent) => void;
  /**
   * Send the thumb to a segment now. Call it from the press handler, before
   * whatever the press changes: the tween is handed to the UI thread there and
   * then, so its progress cannot be held up by the work that follows.
   */
  moveTo: (index: number) => void;
  /** Position, size and fade-in of the thumb itself. */
  thumbX: SharedValue<number>;
  thumbWidth: SharedValue<number>;
  thumbOpacity: SharedValue<number>;
  /**
   * The thumb's position expressed in segments: what the label crossfade and
   * the thumb's colour blend read. Derived from `thumbX`, never written — see
   * the note on it below.
   */
  progress: DerivedValue<number>;
};

export function useSlidingThumb(
  selectedIndex: number,
  /**
   * A continuous page position (0-based, fractional mid-drag) for the thumb to
   * follow instead of tweening to `selectedIndex` itself — see the note on
   * external drivers above. When this is given, everything below that moves the
   * thumb from JS stands down.
   */
  externalProgress?: SharedValue<number>
): SlidingThumb {
  const isExternallyDriven = externalProgress !== undefined;
  // The measurements are held in a ref as well as in state: `moveTo` runs in a
  // press handler, which cannot wait for a render to read them.
  const layoutsRef = useRef<readonly SegmentLayout[]>([]);
  const [layouts, setLayouts] = useState<readonly SegmentLayout[]>([]);
  const hasPositioned = useRef(false);
  /** Where the thumb was last sent, so it is never sent there twice. */
  const appliedRef = useRef<{ index: number; x: number; width: number } | null>(null);
  const thumbX = useSharedValue(0);
  const thumbWidth = useSharedValue(0);
  const thumbOpacity = useSharedValue(0);
  // The same measurements again, on the UI thread, so a driver can be followed
  // to a position *between* two segments without a round trip to JS.
  const layoutXs = useSharedValue<number[]>([]);
  const layoutWidths = useSharedValue<number[]>([]);

  /**
   * Where the thumb is, counted in segments — 1.5 means halfway between the
   * second and third.
   *
   * Derived from `thumbX` rather than animated alongside it — for *every*
   * caller, driven or not. It used to be a third `withTiming` started in the
   * same breath as the position and the width, which made it a *copy* of
   * something the position already says, and copies drift: if that one
   * animation did not land while the other two did, the thumb sat correctly
   * on the new segment while the labels went on crossfading for the old one —
   * the selected colour on the segment the user had just left, the resting
   * colour on the one under the thumb. Reading it off `thumbX` instead makes
   * the two arithmetically incapable of disagreeing, whatever happens to the
   * animation.
   *
   * The externally-driven case used to shortcut this and read
   * `externalProgress.value` directly instead — a second, independent copy of
   * "where the thumb is," which is exactly the kind of drift this whole
   * function exists to rule out. It surfaced as the pill correctly landing on
   * a segment (driven off `thumbX`, which the reaction below keeps current)
   * while the label crossfade — reading this externally-driven shortcut —
   * stayed on the *previous* segment's opacity, showing the resting colour
   * under a thumb that had already arrived.
   */
  const progress = useDerivedValue(() => segmentAtPosition(thumbX.value, layoutXs.value));

  const applyTarget = useCallback(
    (index: number, layout: SegmentLayout) => {
      // Position belongs to the driver; the only thing still owed here is the
      // fade-in, which waits on the same first measurement either way.
      if (isExternallyDriven) return;
      const applied = appliedRef.current;
      if (
        applied &&
        applied.index === index &&
        applied.x === layout.x &&
        applied.width === layout.width
      ) {
        return;
      }
      appliedRef.current = { index, x: layout.x, width: layout.width };
      if (!hasPositioned.current) {
        hasPositioned.current = true;
        thumbX.set(layout.x);
        thumbWidth.set(layout.width);
        thumbOpacity.set(1);
        return;
      }
      const config = { duration: THUMB_SLIDE_MS, easing: THUMB_SLIDE_EASING };
      thumbX.set(withTiming(layout.x, config));
      thumbWidth.set(withTiming(layout.width, config));
    },
    [isExternallyDriven, thumbOpacity, thumbWidth, thumbX]
  );

  const moveTo = useCallback(
    (index: number) => {
      const layout = layoutsRef.current[index];
      // Not measured yet, so there is nowhere to go; the pass below catches it
      // as soon as the layout lands.
      if (!layout) return;
      applyTarget(index, layout);
    },
    [applyTarget]
  );

  const onSegmentLayout = useCallback(
    (index: number, event: LayoutChangeEvent) => {
      const { x, width } = event.nativeEvent.layout;
      const existing = layoutsRef.current[index];
      if (existing && existing.x === x && existing.width === width) return;
      const next = layoutsRef.current.slice();
      next[index] = { x, width };
      layoutsRef.current = next;
      // `Array.from`, not `.map`: a segment whose layout hasn't landed yet
      // leaves a real hole in `next` (not just an `undefined` element), and
      // `.map` skips holes rather than visiting them — the hole would survive
      // into the array reanimated interpolates over, instead of becoming the
      // `0` fallback below.
      layoutXs.set(Array.from(next, (layout) => layout?.x ?? 0));
      layoutWidths.set(Array.from(next, (layout) => layout?.width ?? 0));
      // `isExternallyDriven` only, same reasoning as the reaction log below:
      // this hook backs every `SegmentedControl` on screen, and logging all of
      // them buries the one pager instance we actually care about.
      if (__DEV__ && isExternallyDriven) {
        console.log(
          `[thumb ${Date.now() % 100000}] onSegmentLayout(${index}): x=${x} width=${width} ` +
            `xs=[${Array.from(next, (l) => l?.x ?? "hole").join(",")}] ` +
            `widths=[${Array.from(next, (l) => l?.width ?? "hole").join(",")}] ` +
            `selectedIndex=${selectedIndex}`
        );
      }
      // The opening position is taken here rather than from the pass below,
      // which only runs a commit later: that commit is a frame in which the
      // selected label already wears its selected colour with no thumb behind
      // it to be legible against.
      if (!hasPositioned.current && index === selectedIndex) {
        applyTarget(index, { x, width });
      }
      setLayouts(next);
    },
    [applyTarget, selectedIndex, layoutWidths, layoutXs]
  );

  useLayoutEffect(() => {
    const layout = layouts[selectedIndex];
    if (!layout) return;
    applyTarget(selectedIndex, layout);
  }, [layouts, selectedIndex, applyTarget]);

  // A repair pass, because `appliedRef` above is a *mirror* and a mirror can be
  // wrong.
  //
  // The three quantities travel as three independent animations, and the guard
  // in `applyTarget` refuses to send the thumb anywhere it believes it already
  // is. So anything that leaves one of them behind — an animation cancelled
  // under it, a remount part-way through the travel — sticks for good: the
  // mirror keeps insisting the work was done. The visible form is a control
  // whose *labels* disagree with its own thumb, since the crossfade reads
  // `progress` while the thumb reads `thumbX`, and one segment then wears the
  // selected colour with nothing behind it while the real one stays grey.
  //
  // So once the travel is over, check the values themselves rather than the
  // mirror, and put them where they belong if they are not there. Silent and
  // free in the normal case: the comparison runs once per change and matches.
  useEffect(() => {
    if (isExternallyDriven) return;
    const layout = layouts[selectedIndex];
    if (!layout || !hasPositioned.current) return;

    const settle = setTimeout(() => {
      const isSettled =
        Math.abs(thumbX.get() - layout.x) < SETTLE_EPSILON &&
        Math.abs(thumbWidth.get() - layout.width) < SETTLE_EPSILON;
      if (isSettled) return;

      if (__DEV__) {
        // The only place this state is observable. If it ever prints, it names
        // which of the three was left behind and what it was left at.
        console.warn(
          `[SlidingThumb] left desynced at index ${selectedIndex}: ` +
            `x=${thumbX.get()}/${layout.x} width=${thumbWidth.get()}/${layout.width} ` +
            `opacity=${thumbOpacity.get()}`
        );
      }

      appliedRef.current = { index: selectedIndex, x: layout.x, width: layout.width };
      thumbX.set(layout.x);
      thumbWidth.set(layout.width);
      thumbOpacity.set(1);
    }, THUMB_SLIDE_MS + SETTLE_GRACE_MS);

    return () => clearTimeout(settle);
  }, [layouts, selectedIndex, isExternallyDriven, thumbOpacity, thumbWidth, thumbX]);

  // The whole of the externally driven path, and all of it on the UI thread:
  // the driver moves, the thumb is where it says, in the same frame. Reading
  // the measurements here as well as the position is what seeds the thumb when
  // they land, since a driver at rest publishes nothing to react to.
  useAnimatedReaction(
    () =>
      externalProgress === undefined
        ? null
        : { at: externalProgress.value, xs: layoutXs.value, widths: layoutWidths.value },
    (driver) => {
      // Only ever non-null for a pager-driven control (Activity/Friends), so
      // this never logs for the many other, unrelated `SegmentedControl`s
      // (per-friend visibility toggles etc.) that also run this hook.
      if (__DEV__ && driver !== null) {
        console.log(
          `[thumb ${Date.now() % 100000}] reaction: at=${driver.at} ` +
            `xs=[${driver.xs.join(",")}] widths=[${driver.widths.join(",")}]` +
            (driver.xs.length === 0 ? " -> skip (no layouts yet)" : " -> apply")
        );
      }
      if (driver === null || driver.xs.length === 0) return;
      thumbX.set(interpolateAcrossSegments(driver.at, driver.xs));
      thumbWidth.set(interpolateAcrossSegments(driver.at, driver.widths));
      thumbOpacity.set(1);
    }
  );

  return { onSegmentLayout, moveTo, thumbX, thumbWidth, thumbOpacity, progress };
}

/**
 * Fade for a segment's resting-colour copy: the exact inverse of
 * `useSelectedCopyStyle`. Only needed where the two copies are not the same
 * shape — a bolder selected label, say — because a copy left opaque underneath
 * one that does not cover it exactly shows through as a ghost. Where the copies
 * differ only in colour, leave the resting one opaque: it keeps the label at
 * full strength for the whole of the travel.
 */
export function useRestingCopyStyle(thumb: SlidingThumb, index: number) {
  return useAnimatedStyle(() => ({
    opacity: 1 - selectedFraction(thumb.progress.value, index) * thumb.thumbOpacity.value,
  }));
}

/**
 * Fade for a segment's selected-colour copy: fully in only while the thumb is
 * on this segment, and on its way out for as long as the thumb is travelling to
 * the next one. Text colour is not something Reanimated can drive through
 * `ThemedText`, so each segment stacks two copies and crossfades them; swapping
 * the colour on press instead would paint the selected label's colour onto the
 * bare track for as long as the slide lasts.
 *
 * Held back by `thumbOpacity` for the same reason the thumb is: until the
 * segments have been measured there is nothing behind the label for a selected
 * colour to be legible against.
 */
export function useSelectedCopyStyle(thumb: SlidingThumb, index: number) {
  return useAnimatedStyle(() => ({
    opacity: selectedFraction(thumb.progress.value, index) * thumb.thumbOpacity.value,
  }));
}

/**
 * The inverse of {@link interpolateAcrossSegments}: a thumb x read back as a
 * position in segments, so 1.5 is halfway between the second and third.
 *
 * Module scope, and written without an inline closure, on purpose: a function
 * a worklet ends up calling has to have been workletised too, and only the
 * ones declared out here — like {@link interpolateAcrossSegments} — reliably
 * are. An arrow created inside the worklet body normally comes along with it,
 * but a build step that lifts it back out leaves the UI runtime holding a
 * plain JS function, which it cannot call ("Tried to synchronously call a
 * Remote function"). Keeping the helper here does not depend on which step did
 * what.
 */
function segmentAtPosition(x: number, xs: readonly number[]): number {
  "worklet";
  // `interpolate` needs a strictly increasing input range, which segment x's
  // are — left to right — once they have all been measured. Until then there
  // is no position to report, and `thumbOpacity` is still 0, so nothing that
  // reads this is on screen anyway.
  if (xs.length < 2) return 0;
  const indices: number[] = [];
  for (let index = 0; index < xs.length; index += 1) indices.push(index);
  return interpolate(x, xs as number[], indices, Extrapolation.CLAMP);
}

/**
 * One segment measurement read at a fractional position: halfway between
 * segments 1 and 2 gives halfway between their two x's (or widths), so a thumb
 * following a drag resizes across segments of unequal width as it travels.
 */
function interpolateAcrossSegments(at: number, values: readonly number[]): number {
  "worklet";
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const indices = values.map((_, index) => index);
  return interpolate(at, indices, values as number[], Extrapolation.CLAMP);
}

/** 1 while the thumb is on segment `index`, 0 once it has reached a neighbour. */
function selectedFraction(progress: number, index: number): number {
  "worklet";
  return interpolate(progress, [index - 1, index, index + 1], [0, 1, 0], Extrapolation.CLAMP);
}
