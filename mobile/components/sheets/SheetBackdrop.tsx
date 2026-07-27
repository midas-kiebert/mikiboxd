/**
 * The dimmed backdrop behind every app bottom sheet.
 *
 * It is a near-copy of gorhom's `BottomSheetBackdrop`, and exists for one
 * difference: *when it stops intercepting touches*.
 *
 * gorhom ties touchability to `disappearsOnIndex`, the same index its fade ends
 * on. For a modal sheet that index has to be -1 (the closed position), so the
 * backdrop keeps swallowing touches for the whole close animation even though it
 * is already almost fully transparent — closing the sheet and immediately
 * scrolling the list underneath did nothing for ~a quarter of a second.
 *
 * Here the two are separate: the fade still runs all the way down to -1, but
 * touchability is dropped as soon as the sheet leaves its open position, so the
 * screen behind is live from the first frame of the close.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, type ViewProps } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
} from "react-native-reanimated";
import { type BottomSheetBackdropProps, useBottomSheet } from "@gorhom/bottom-sheet";

/** Dim level at the sheet's open position, shared by every sheet. */
const BACKDROP_OPACITY = 0.45;

/**
 * How far the sheet has to have moved off its open position before the backdrop
 * stops taking touches. Just off zero: far enough that it can't trip while the
 * sheet sits open, close enough that it lands on the first frame of a close.
 */
const TOUCHABLE_INDEX_THRESHOLD = -0.02;

type SheetBackdropProps = BottomSheetBackdropProps & {
  /** "close" (default) dismisses the sheet on a backdrop press; "none" locks it. */
  pressBehavior?: "close" | "none";
};

export default function SheetBackdrop({
  animatedIndex,
  style,
  pressBehavior = "close",
}: SheetBackdropProps) {
  const { close } = useBottomSheet();

  // The backdrop can be torn down mid-animation; the reaction below hops to the
  // JS thread, so its setState can land after that.
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [pointerEvents, setPointerEvents] = useState<ViewProps["pointerEvents"]>("none");

  const setTouchable = useCallback((isTouchable: boolean) => {
    if (isMountedRef.current) setPointerEvents(isTouchable ? "auto" : "none");
  }, []);

  useAnimatedReaction(
    () => animatedIndex.value > TOUCHABLE_INDEX_THRESHOLD,
    (isTouchable, previous) => {
      if (isTouchable === previous) return;
      runOnJS(setTouchable)(isTouchable);
    }
  );

  const tapGesture = useMemo(() => Gesture.Tap().onEnd(() => runOnJS(close)()), [close]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      animatedIndex.value,
      [-1, 0],
      [0, BACKDROP_OPACITY],
      Extrapolation.CLAMP
    ),
  }));

  const backdrop = (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.backdrop, style, animatedStyle]}
      pointerEvents={pointerEvents}
      accessibilityHint="Tap to close the sheet"
    />
  );

  return pressBehavior === "close" ? (
    <GestureDetector gesture={tapGesture}>{backdrop}</GestureDetector>
  ) : (
    backdrop
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "#000",
  },
});
