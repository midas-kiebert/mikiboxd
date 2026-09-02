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
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

/** One travel of the thumb, and the crossfade of the labels it passes. */
export const THUMB_SLIDE_MS = 220;
export const THUMB_SLIDE_EASING = Easing.out(Easing.cubic);

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
  /** The selected index as a continuous value: what colours crossfade on. */
  progress: SharedValue<number>;
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
  const progress = useSharedValue(selectedIndex);
  // The same measurements again, on the UI thread, so a driver can be followed
  // to a position *between* two segments without a round trip to JS.
  const layoutXs = useSharedValue<number[]>([]);
  const layoutWidths = useSharedValue<number[]>([]);

  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

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
        thumbX.value = layout.x;
        thumbWidth.value = layout.width;
        progress.value = index;
        thumbOpacity.value = 1;
        return;
      }
      const config = { duration: THUMB_SLIDE_MS, easing: THUMB_SLIDE_EASING };
      thumbX.value = withTiming(layout.x, config);
      thumbWidth.value = withTiming(layout.width, config);
      progress.value = withTiming(index, config);
    },
    [isExternallyDriven, progress, thumbOpacity, thumbWidth, thumbX]
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
      layoutXs.value = next.map((layout) => layout?.x ?? 0);
      layoutWidths.value = next.map((layout) => layout?.width ?? 0);
      // The opening position is taken here rather than from the pass below,
      // which only runs a commit later: that commit is a frame in which the
      // selected label already wears its selected colour with no thumb behind
      // it to be legible against.
      if (!hasPositioned.current && index === selectedIndexRef.current) {
        applyTarget(index, { x, width });
      }
      setLayouts(next);
    },
    [applyTarget]
  );

  useLayoutEffect(() => {
    const layout = layouts[selectedIndex];
    if (!layout) return;
    applyTarget(selectedIndex, layout);
  }, [layouts, selectedIndex, applyTarget]);

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
      if (driver === null || driver.xs.length === 0) return;
      thumbX.value = interpolateAcrossSegments(driver.at, driver.xs);
      thumbWidth.value = interpolateAcrossSegments(driver.at, driver.widths);
      progress.value = driver.at;
      thumbOpacity.value = 1;
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
