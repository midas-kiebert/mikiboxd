/**
 * The spinner at the bottom of a paginated list.
 *
 * The footer always occupies its full height, whether or not it is spinning —
 * only the spinner itself fades. Animating the *height* (or rendering the
 * spinner conditionally) is what made pagination feel janky: with no reserved
 * space the list ends flush with the last row, so a fast scroll hits a hard
 * stop, the appearing spinner then grows space below the current offset (you
 * have to scroll again to see it), and its collapse yanks the offset back up
 * because the content it was scrolled into no longer exists. A constant-height
 * footer removes the layout change entirely: the spinner is already on screen
 * when the list bottoms out, and the new page simply appears above it.
 *
 * The reserved row doubles as the list's end spacer, so callers don't need a
 * separate one.
 */
import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Easing, StyleSheet } from "react-native";

import { useThemeColors } from "@/hooks/use-theme-color";

/** The row each spinner size occupies: the indicator (36 / 20pt) plus padding. */
const FOOTER_HEIGHT: Record<"small" | "large", number> = { small: 56, large: 76 };
/** Appearing is a response to the user reaching the end — it should keep up. */
const SHOW_DURATION_MS = 160;
/** Fading out is slow enough to read as the page settling, not as a blink. */
const HIDE_DURATION_MS = 260;

type LoadMoreFooterProps = {
  loading: boolean;
  /** Matches whatever the list used before; purely cosmetic. */
  size?: "small" | "large";
};

export default function LoadMoreFooter({ loading, size = "large" }: LoadMoreFooterProps) {
  const colors = useThemeColors();
  const opacity = useRef(new Animated.Value(loading ? 1 : 0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: loading ? 1 : 0,
      duration: loading ? SHOW_DURATION_MS : HIDE_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [loading, opacity]);

  return (
    <Animated.View
      style={[styles.footer, { height: FOOTER_HEIGHT[size], opacity }]}
      pointerEvents="none"
    >
      <ActivityIndicator size={size} color={colors.tint} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  footer: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
