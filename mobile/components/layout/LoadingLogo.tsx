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
 * The spinner is an `ActivityIndicator` and not a pulsing logo on purpose:
 * what this covers is a heavy render, i.e. the JS thread is busy for most of
 * the time it is on screen, and `Animated.loop` over a sequence steps between
 * its halves from JS — a pulse would stall exactly when it is meant to be
 * saying "still working". `ActivityIndicator` spins natively and cannot.
 */
import { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/** Short enough that a wait which never happens is never seen. */
export const LOADING_LOGO_FADE_IN_MS = 140;

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
  fadeIn = false,
  style,
}: LoadingLogoProps) {
  const opacity = useRef(new Animated.Value(fadeIn ? 0 : 1)).current;

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

  return (
    <Animated.View style={[styles.container, style, { opacity }]}>
      <Image
        source={require("../../assets/images/splash-icon.png")}
        style={{ width: logoSize, height: logoSize }}
        resizeMode="contain"
      />
      <ActivityIndicator size="small" color={tintColor} />
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
