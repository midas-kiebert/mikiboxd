/**
 * Tweens its own height to whatever its children currently need.
 *
 * For content that grows and shrinks under the user — search results arriving,
 * an empty state replacing a list — where the alternative is everything below
 * jumping by a card's height with no transition.
 *
 * Deliberately not `LayoutAnimation`: that has to be armed before the state
 * change that moves things, which is awkward when the change comes from a query
 * resolving rather than a tap, and its support varies by platform and
 * architecture. Measuring the content and driving the height directly behaves
 * identically everywhere.
 */
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  type LayoutChangeEvent,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { useAnimatedValue } from "@/hooks/useAnimatedValue";

const DEFAULT_DURATION_MS = 240;

type AnimatedHeightProps = {
  children: ReactNode;
  /** Length of the height tween. */
  duration?: number;
  style?: StyleProp<ViewStyle>;
};

export default function AnimatedHeight({
  children,
  duration = DEFAULT_DURATION_MS,
  style,
}: AnimatedHeightProps) {
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const height = useAnimatedValue(0);
  // The first measurement is the starting point, not a change to animate from.
  const hasSettledOnceRef = useRef(false);

  const handleContentLayout = (event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    setContentHeight((current) => (current === nextHeight ? current : nextHeight));
  };

  useEffect(() => {
    if (contentHeight === null) return;
    if (!hasSettledOnceRef.current) {
      hasSettledOnceRef.current = true;
      height.setValue(contentHeight);
      return;
    }
    const animation = Animated.timing(height, {
      toValue: contentHeight,
      duration,
      easing: Easing.out(Easing.cubic),
      // Height is a layout property; it cannot run on the native driver.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [contentHeight, duration, height]);

  return (
    <Animated.View style={[styles.clip, { height }, style]}>
      {/* Absolute so it keeps its natural height while the parent above is
          clamped to the animated value mid-tween. */}
      <View style={styles.content} onLayout={handleContentLayout}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: "hidden",
  },
  content: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
  },
});
