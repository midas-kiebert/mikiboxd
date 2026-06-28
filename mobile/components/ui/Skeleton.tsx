import { useCallback } from "react";
import { type LayoutChangeEvent, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing,
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { useThemeColors } from "@/hooks/use-theme-color";

// Sweep across, then rest fully off-screen before sweeping again — the pause is
// what makes a shimmer read as deliberate/premium instead of a frantic loop.
const SWEEP_MS = 1000;
const REST_MS = 700;
// Fraction of the container the highlight band spans.
const SHINE_RATIO = 0.7;

// A single 0→1 clock shared by every Skeleton, driven on the UI thread and
// running continuously for the life of the app. One shared clock means all
// skeletons on screen sweep in lockstep with each other, while a fresh batch on
// the next pull-to-refresh simply picks up wherever the clock already is — so it
// doesn't restart from the same spot every time. The sequence holds at 1 (band
// parked off the right edge) for REST_MS, then withRepeat snaps back to 0 (band
// parked off the left edge) — both ends are invisible, so there is no jump.
const sweep = makeMutable(0);
sweep.value = withRepeat(
  withSequence(
    withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.ease) }),
    withTiming(1, { duration: REST_MS })
  ),
  -1
);

/**
 * Base loading placeholder: a tinted block with a soft highlight that sweeps
 * across it, so skeletons read as "actively loading" instead of static gray
 * boxes. Drop in anywhere a `<View style={...} />` bone was used before —
 * width/height/borderRadius/backgroundColor all come from `style`.
 */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const colors = useThemeColors();
  // A shared value (not React state) so layout never forces a re-render that
  // would rebuild the worklet — width is read straight off the UI thread.
  const width = useSharedValue(0);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      width.value = e.nativeEvent.layout.width;
    },
    [width]
  );

  const shineStyle = useAnimatedStyle(() => {
    // Stay invisible until the first real measurement lands, otherwise the band
    // renders at a bogus pre-layout size for a frame and visibly snaps.
    if (width.value === 0) {
      return { opacity: 0 };
    }
    const shineWidth = width.value * SHINE_RATIO;
    // Travels from fully off the left edge (-shineWidth) to fully off the right
    // edge (width), so the highlight only ever enters/leaves out of view.
    const translateX = sweep.value * (width.value + shineWidth) - shineWidth;
    return {
      opacity: 1,
      width: shineWidth,
      transform: [{ translateX }],
    };
  });

  return (
    <View
      onLayout={onLayout}
      style={[styles.base, { backgroundColor: colors.posterPlaceholder }, style]}
    >
      <Animated.View style={[styles.shine, shineStyle]}>
        <LinearGradient
          colors={["transparent", colors.skeletonShine, "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: "hidden",
  },
  shine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
});
