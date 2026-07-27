/**
 * The spinner at the bottom of a paginated list, which collapses instead of
 * vanishing.
 *
 * A plain `{loading ? <ActivityIndicator/> : null}` footer takes a whole row of
 * height out of the list the instant the next page resolves, so everything
 * above it snaps upward on the same frame the new rows appear — the list looks
 * like it jumped rather than grew. Tweening the footer's own height and opacity
 * turns that into one continuous movement: the new rows are already in place
 * while the spinner's row closes up under them.
 *
 * Height is animated directly rather than via `AnimatedHeight` because there is
 * nothing to measure — the spinner is a fixed size — and because the fade has
 * to run *with* the collapse. Handing `AnimatedHeight` a null child would
 * collapse an empty gap after the spinner had already blinked out.
 */
import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Easing, StyleSheet } from "react-native";

import { useThemeColors } from "@/hooks/use-theme-color";

/** The row each spinner size occupies: the indicator (36 / 20pt) plus padding. */
const FOOTER_HEIGHT: Record<"small" | "large", number> = { small: 56, large: 76 };
/** Appearing is a response to the user reaching the end — it should keep up. */
const SHOW_DURATION_MS = 160;
/** Leaving is the part that used to snap, so it gets the longer half. */
const HIDE_DURATION_MS = 260;

type LoadMoreFooterProps = {
  loading: boolean;
  /** Matches whatever the list used before; purely cosmetic. */
  size?: "small" | "large";
};

export default function LoadMoreFooter({ loading, size = "large" }: LoadMoreFooterProps) {
  const colors = useThemeColors();
  // One value drives both height and opacity, so the row closes and the spinner
  // fades on the same curve instead of one after the other.
  const progress = useRef(new Animated.Value(loading ? 1 : 0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: loading ? 1 : 0,
      duration: loading ? SHOW_DURATION_MS : HIDE_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      // Height is a layout property; it cannot run on the native driver.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [loading, progress]);

  return (
    <Animated.View
      style={[
        styles.footer,
        {
          height: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, FOOTER_HEIGHT[size]],
          }),
          opacity: progress,
        },
      ]}
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
