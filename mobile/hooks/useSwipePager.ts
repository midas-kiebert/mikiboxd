/**
 * A horizontal pager: pages laid out in one row that the finger drags, and that
 * settles on whichever page the gesture was heading for when it was let go.
 *
 * The hook owns the motion as one shared value, `progress` — the page position,
 * counted in pages and fractional mid-drag. The row's offset is that value, and
 * so is the segmented control's thumb (hand it straight to `SegmentedControl`'s
 * `progress` prop), which is how the two stay welded together through a drag,
 * a flick and a tap alike.
 *
 * Everything visible happens on the UI thread, and that is the point rather
 * than a nicety. Committing a page change re-renders a screenful of feed
 * content; on Android that ran for a second or more *after* the swipe was over.
 * Anything waiting on React to come back — the thumb, above all — sat frozen on
 * the page the user had already left. So the gesture moves `progress` itself,
 * and React is told afterwards, as bookkeeping.
 *
 * The page *index* stays the caller's state, so a change from anywhere else (a
 * deep link) arrives as a normal prop and is tweened to like any other. A tap on
 * the control goes through {@link SwipePager.goTo} first, for the same reason
 * the gesture does not wait: `setState` alone would not move anything until the
 * commit it triggers has finished.
 *
 * The pan is horizontal-only (`activeOffsetX`/`failOffsetY`): each page here
 * holds a vertically scrolling list with a pull-to-refresh of its own, and both
 * of those are gestures that start the same way. A drag that is at all vertical
 * must be the list's, so this one refuses it rather than racing for it.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

import { THUMB_SLIDE_EASING, THUMB_SLIDE_MS } from "@/components/ui/use-sliding-thumb";

/** Past this, a flick changes page however short it was. */
const FLICK_VELOCITY = 500;
/** Otherwise the drag has to have covered this much of a page to count. */
const PAGE_TURN_FRACTION = 0.3;
/** How far a drag may pull past the first/last page, as a fraction of itself. */
const OVERSCROLL_RESISTANCE = 0.25;
/** A drag this much more vertical than horizontal belongs to the list inside. */
const HORIZONTAL_ACTIVATION_PX = 12;
const VERTICAL_ABORT_PX = 12;

export type SwipePager = {
  /** Page position in pages, fractional mid-drag. Drives the row and the thumb. */
  progress: SharedValue<number>;
  panGesture: ReturnType<typeof Gesture.Pan>;
  /**
   * Start moving to a page now, without waiting for a render. Call it from the
   * handler that also sets the index — a tap on the control above the pager —
   * so the movement is under way before the commit that change sets off.
   */
  goTo: (index: number) => void;
};

export function useSwipePager({
  pageCount,
  index,
  onIndexChange,
  pageWidth,
}: {
  pageCount: number;
  index: number;
  onIndexChange: (index: number) => void;
  /** One page's width; the row is `pageCount` of these. */
  pageWidth: number;
}): SwipePager {
  const progress = useSharedValue(index);
  // Which page the pager is resting on, as the *gesture* sees it. A shared
  // value and not a ref: the handlers below are worklets, and a ref captured by
  // one is copied to the UI thread at the moment the gesture is built, so its
  // `.current` would sit frozen on the page the pager opened at. Every drag
  // from any other page then measures itself from the wrong origin — it starts
  // by jumping, and its target lands back on the page it began on.
  const restingIndex = useSharedValue(index);
  // Where the pager was last sent from JS, so neither `goTo` nor the sync below
  // restarts a tween that is already running to the same page.
  const settledRef = useRef(index);
  // The most recently rendered `index`, updated in the render body rather than
  // an effect — so it is current by the time *any* effect actually runs, no
  // matter how late. The sync effect below reads this instead of its own
  // `index` closure: under load (three feed pages re-rendering, a burst of
  // queries), React can badly backlog a passive effect's scheduling, and one
  // finally running late would otherwise still be holding the `index` from
  // whatever render it was scheduled by — stale relative to a newer `commit()`
  // that has since moved `settledRef` on. Diffing that stale value against the
  // now-current `settledRef` reads as an outside change to catch up to, and
  // "corrects" the pager backward to the old page before a second, newer
  // effect corrects it forward again — the pager visibly swapping pages on
  // its own, well after the user's gesture had already settled.
  const latestIndexRef = useRef(index);
  latestIndexRef.current = index;

  const settle = useCallback(
    (target: number) => {
      "worklet";
      progress.set(
        withTiming(target, {
          duration: THUMB_SLIDE_MS,
          easing: THUMB_SLIDE_EASING,
        })
      );
    },
    [progress]
  );

  // Takes no argument on purpose: `runOnJS` is asynchronous, and a fast
  // back-and-forth can queue several of these before the JS thread catches
  // up. A `target` captured on the UI thread at the moment the gesture ended
  // would still be delivered, stale, once its turn came — applying a page
  // the pager had already moved past, which read as it swapping pages on its
  // own after the user had let go. Reading `restingIndex` fresh here instead
  // means whichever commit call actually runs applies the true current
  // position, so a stale, superseded one is just a no-op.
  const commit = useCallback(() => {
    const current = restingIndex.value;
    if (__DEV__) {
      console.log(
        `[pager ${Date.now() % 100000}] commit(): restingIndex=${current} settledRef=${settledRef.current}` +
          (settledRef.current === current ? " -> no-op" : " -> onIndexChange")
      );
    }
    if (settledRef.current === current) return;
    settledRef.current = current;
    onIndexChange(current);
  }, [onIndexChange, restingIndex]);

  const goTo = useCallback(
    (target: number) => {
      if (__DEV__) {
        console.log(
          `[pager ${Date.now() % 100000}] goTo(${target}): settledRef=${settledRef.current}` +
            (settledRef.current === target ? " -> no-op" : " -> animate")
        );
      }
      if (settledRef.current === target) return;
      settledRef.current = target;
      restingIndex.set(target);
      progress.set(
        withTiming(target, {
          duration: THUMB_SLIDE_MS,
          easing: THUMB_SLIDE_EASING,
        })
      );
    },
    [progress, restingIndex]
  );

  // Catches every index change that did not come through the gesture or `goTo`:
  // a deep link, or state restored from elsewhere. Reads `latestIndexRef`
  // rather than closing over `index` directly — see the ref's own comment for
  // why a stale closure here is what caused the pager to swap pages on its
  // own after a fast, repeated swipe.
  useEffect(() => {
    const target = latestIndexRef.current;
    if (__DEV__) {
      console.log(
        `[pager ${Date.now() % 100000}] sync effect: index=${target} settledRef=${settledRef.current}` +
          (settledRef.current === target ? " -> no-op" : " -> animate")
      );
    }
    if (settledRef.current === target) return;
    settledRef.current = target;
    restingIndex.set(target);
    progress.set(
      withTiming(target, {
        duration: THUMB_SLIDE_MS,
        easing: THUMB_SLIDE_EASING,
      })
    );
  }, [index, progress, restingIndex]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-HORIZONTAL_ACTIVATION_PX, HORIZONTAL_ACTIVATION_PX])
        .failOffsetY([-VERTICAL_ABORT_PX, VERTICAL_ABORT_PX])
        .onUpdate((event) => {
          // Dragging left (negative) moves *towards* the next page, so the
          // translation is subtracted.
          const dragged = restingIndex.value - event.translationX / pageWidth;
          const last = pageCount - 1;
          if (dragged < 0) {
            progress.set(dragged * OVERSCROLL_RESISTANCE);
          } else if (dragged > last) {
            progress.set(last + (dragged - last) * OVERSCROLL_RESISTANCE);
          } else {
            progress.set(dragged);
          }
        })
        .onEnd((event) => {
          const covered = event.translationX / pageWidth;
          const flicked = Math.abs(event.velocityX) > FLICK_VELOCITY;
          const turned = flicked || Math.abs(covered) > PAGE_TURN_FRACTION;
          const direction = Math.sign(flicked ? event.velocityX : covered);
          const from = restingIndex.value;
          const target = Math.min(Math.max(from - (turned ? direction : 0), 0), pageCount - 1);
          if (__DEV__) {
            console.log(
              `[pager] onEnd: from=${from} target=${target} covered=${covered.toFixed(2)} ` +
                `velocityX=${event.velocityX.toFixed(0)} flicked=${flicked}`
            );
          }
          settle(target);
          if (target !== from) {
            // Set here rather than waiting for the commit to come back round
            // through React, so a second swipe started before that lands still
            // measures itself from the page this one is settling on.
            restingIndex.set(target);
            runOnJS(commit)();
          }
        }),
    [pageCount, pageWidth, settle, commit, progress, restingIndex]
  );

  return { progress, panGesture, goTo };
}
