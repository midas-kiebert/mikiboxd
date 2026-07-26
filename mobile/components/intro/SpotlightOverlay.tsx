/**
 * The overlay that dims everything except one control and explains it: four dim
 * panes around a measured rectangle, a pulsing ring on the rectangle itself, and
 * a caption card in whichever gap is bigger.
 *
 * Four panes rather than a masked cut-out: masking needs an SVG/mask layer that
 * would have to be kept in step with the theme, while four plain Views give the
 * same hole, cost nothing, and leave the hole genuinely untouched — so a caller
 * that wants the real control tapped through it only has to pass
 * `onPressTarget`.
 *
 * Deliberately not a Modal: the intro's own Modal already covers the screen for
 * the showtime tour, and nesting Modals is unreliable on iOS. Callers that need
 * a window of their own (see `IntroFiltersSpotlight`) wrap it in one themselves.
 */
import { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

/** A control's position on screen, in window coordinates (`measureInWindow`). */
export type SpotlightRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Breathing room between the highlighted control and the ring around it. */
const HOLE_PADDING = 8;
const HOLE_BORDER_RADIUS = 14;
/** Gap between the hole and the caption card. */
const CAPTION_GAP = 18;
const CAPTION_SIDE_MARGIN = 20;
/** Clears the intro's own progress/skip row when the caption is pinned up top. */
const CAPTION_TOP_OFFSET = 56;
const PULSE_DURATION_MS = 950;

type SpotlightOverlayProps = {
  /**
   * Where the highlighted control is. Null while it is still being measured:
   * the screen dims and the caption shows, but nothing is cut out yet, so the
   * overlay never flashes a hole in the wrong place.
   */
  target: SpotlightRect | null;
  /**
   * Where the caption goes. "auto" puts it in whichever gap around the target
   * is bigger. "top" pins it to the top of the screen: use it when the target
   * moves between steps, so the words stay put instead of jumping around.
   */
  captionPlacement?: "auto" | "top";
  title: string;
  message?: string;
  /** e.g. "1 of 3", shown quietly next to the buttons. */
  stepLabel?: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /**
   * Runs when the highlighted control itself is tapped. Omit to leave the hole
   * inert — which is what a showcase over mock data wants.
   */
  onPressTarget?: () => void;
};

export default function SpotlightOverlay({
  target,
  captionPlacement = "auto",
  title,
  message,
  stepLabel,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  onPressTarget,
}: SpotlightOverlayProps) {
  // Read flow: layout maths first, then the animation, then the JSX.
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // The hole, padded and clipped to the screen so a control at the very edge
  // cannot push a pane to a negative size.
  const hole = useMemo(() => {
    if (!target) return null;
    const left = Math.max(0, target.x - HOLE_PADDING);
    const top = Math.max(0, target.y - HOLE_PADDING);
    return {
      left,
      top,
      width: Math.min(windowWidth - left, target.width + HOLE_PADDING * 2),
      height: Math.min(windowHeight - top, target.height + HOLE_PADDING * 2),
    };
  }, [target, windowHeight, windowWidth]);

  // Auto-placed captions go wherever there is more room, so they never land on
  // top of the very thing they are pointing at. An unmeasured target has no
  // room to compare, so it falls back to the top.
  const captionPosition = useMemo(() => {
    const pinnedToTop = { top: insets.top + CAPTION_TOP_OFFSET };
    if (captionPlacement === "top" || !hole) return pinnedToTop;
    const spaceAbove = hole.top - insets.top;
    const spaceBelow = windowHeight - insets.bottom - (hole.top + hole.height);
    return spaceBelow >= spaceAbove
      ? { top: hole.top + hole.height + CAPTION_GAP }
      : { bottom: windowHeight - hole.top + CAPTION_GAP };
  }, [captionPlacement, hole, insets.bottom, insets.top, windowHeight]);

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: PULSE_DURATION_MS,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: PULSE_DURATION_MS,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const ringOpacity = useMemo(
    () => pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
    [pulse]
  );
  const ringScale = useMemo(
    () => pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }),
    [pulse]
  );

  const handlePressTarget = () => {
    if (!onPressTarget) return;
    triggerSelectionHaptic();
    onPressTarget();
  };

  const handlePrimary = () => {
    triggerSelectionHaptic();
    onPrimary();
  };

  const handleSecondary = () => {
    if (!onSecondary) return;
    triggerSelectionHaptic();
    onSecondary();
  };

  // Render/output using the geometry and animation prepared above.
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {hole ? (
        <>
          <View style={[styles.dim, { top: 0, left: 0, right: 0, height: hole.top }]} />
          <View
            style={[
              styles.dim,
              { top: hole.top + hole.height, left: 0, right: 0, bottom: 0 },
            ]}
          />
          <View
            style={[styles.dim, { top: hole.top, left: 0, width: hole.left, height: hole.height }]}
          />
          <View
            style={[
              styles.dim,
              { top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height },
            ]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                top: hole.top,
                left: hole.left,
                width: hole.width,
                height: hole.height,
                opacity: ringOpacity,
                transform: [{ scale: ringScale }],
              },
            ]}
          />
          {onPressTarget ? (
            <TouchableOpacity
              style={{
                position: "absolute",
                top: hole.top,
                left: hole.left,
                width: hole.width,
                height: hole.height,
              }}
              onPress={handlePressTarget}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={title}
            />
          ) : null}
        </>
      ) : (
        <View style={[styles.dim, StyleSheet.absoluteFillObject]} />
      )}

      <View style={[styles.caption, captionPosition]}>
        <ThemedText style={styles.title}>{title}</ThemedText>
        {message ? <ThemedText style={styles.message}>{message}</ThemedText> : null}
        <View style={styles.actions}>
          {stepLabel ? <ThemedText style={styles.stepLabel}>{stepLabel}</ThemedText> : null}
          {secondaryLabel && onSecondary ? (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleSecondary}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <ThemedText style={styles.secondaryLabel}>{secondaryLabel}</ThemedText>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handlePrimary}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <ThemedText style={styles.primaryLabel}>{primaryLabel}</ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    // Light enough that the sheet being explained is still readable behind it.
    dim: {
      position: "absolute",
      backgroundColor: "rgba(0, 0, 0, 0.6)",
    },
    ring: {
      position: "absolute",
      borderRadius: HOLE_BORDER_RADIUS,
      borderWidth: 2.5,
      borderColor: colors.tint,
    },
    caption: {
      position: "absolute",
      left: CAPTION_SIDE_MARGIN,
      right: CAPTION_SIDE_MARGIN,
      gap: 10,
      padding: 18,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      shadowColor: "#000",
      shadowOpacity: 0.3,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
      elevation: 14,
    },
    title: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "800",
      color: colors.text,
    },
    message: {
      fontSize: 15,
      lineHeight: 21,
      color: colors.textSecondary,
    },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      // Right-aligned without a step label; the label's own flex takes over
      // when there is one.
      justifyContent: "flex-end",
      gap: 10,
      marginTop: 2,
    },
    stepLabel: {
      flex: 1,
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    secondaryButton: {
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    secondaryLabel: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    primaryButton: {
      minWidth: 108,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.tint,
    },
    primaryLabel: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.pillActiveText,
    },
  });
