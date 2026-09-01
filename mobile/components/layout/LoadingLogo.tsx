/**
 * The app's "still working" panel: the splash logo, a spinner under it and a
 * line of text.
 *
 * Shared so every wait in the app looks like the same wait — the theme curtain
 * and any sheet or screen that defers an expensive mount all put this up. A
 * screen that can show the *shape* of what is coming should still prefer a
 * skeleton (see {@link ../layout/TabScreenSkeleton}); this is for the waits
 * that have no shape to promise yet.
 *
 * Colours are props rather than read from the theme hook, because the theme
 * curtain is painted in the palette being switched *to*, which the hook cannot
 * know yet.
 *
 * The logo breathes, the same slow swell the splash screen uses, so a wait
 * mid-app reads as the same app still starting up. It must be *one* native
 * animation looping forever, never `Animated.loop` over a sequence: what this
 * covers is a heavy render, i.e. the JS thread is busy for most of the time
 * the panel is on screen, and a sequence steps between its halves from JS —
 * so it would stall exactly when it is meant to be saying "still working".
 * A single timing driven natively cannot stall; the swell's shape comes from
 * interpolating that one linear ramp, not from chaining animations.
 *
 * The `ActivityIndicator` stays for the reason it was there before the
 * breathing existed: it is unambiguous progress, where the swell is only
 * atmosphere. Callers that already have their own spinner drop it.
 */
import { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/** Short enough that a wait which never happens is never seen. */
export const LOADING_LOGO_FADE_IN_MS = 140;

/** One full breath in and out, matching the splash screen's pulse. */
const BREATHE_DURATION_MS = 1800;

/**
 * A sine-shaped swell sampled off the loop's single linear ramp: at rest at
 * both ends so the loop's seam is invisible, easing in and out of the peak
 * the way chained `Easing.inOut` timings would, but without the JS hand-off.
 */
const BREATHE_INPUT_RANGE = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
const BREATHE_SCALE_RANGE = [1, 1.009, 1.03, 1.051, 1.06, 1.051, 1.03, 1.009, 1];

type LoadingLogoProps = {
  /** The line under the spinner. Omit for a wait too short to read. */
  label?: string;
  /** Spinner colour — the palette's `tint`. */
  tintColor: string;
  /** Label colour — the palette's `textSecondary`. */
  labelColor: string;
  /** Smaller for a panel inside a sheet than for a full-screen curtain. */
  logoSize?: number;
  /**
   * Drops the `ActivityIndicator`, for a caller that already has its own
   * spinner on screen — pull-to-refresh's `RefreshControl`, say — so the two
   * don't spin side by side.
   */
  hideSpinner?: boolean;
  /**
   * Fade in instead of appearing outright, for callers that put this up on
   * every open: most opens are fast enough that the panel is gone before the
   * fade finishes, so the quick ones show nothing rather than a blink.
   * Native-driven, so the render this covers cannot stall it.
   */
  fadeIn?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function LoadingLogo({
  label,
  tintColor,
  labelColor,
  logoSize = 140,
  hideSpinner = false,
  fadeIn = false,
  style,
}: LoadingLogoProps) {
  const opacity = useRef(new Animated.Value(fadeIn ? 0 : 1)).current;
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(breathe, {
        toValue: 1,
        duration: BREATHE_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [breathe]);

  useEffect(() => {
    if (!fadeIn) return;
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: LOADING_LOGO_FADE_IN_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
      // Never hold the interaction handle: the mount this is covering is
      // usually scheduled off one.
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [fadeIn, opacity]);

  const scale = breathe.interpolate({
    inputRange: BREATHE_INPUT_RANGE,
    outputRange: BREATHE_SCALE_RANGE,
  });

  return (
    <Animated.View style={[styles.container, style, { opacity }]}>
      <Animated.Image
        source={require("../../assets/images/splash-icon.png")}
        style={{ width: logoSize, height: logoSize, transform: [{ scale }] }}
        resizeMode="contain"
      />
      {hideSpinner ? null : <ActivityIndicator size="small" color={tintColor} />}
      {label ? <Text style={[styles.label, { color: labelColor }]}>{label}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
});
