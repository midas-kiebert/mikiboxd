/**
 * Cross-fades a sheet's content in over the loading panel it replaces.
 *
 * The swap is otherwise a hard cut on the frame the body commits, which reads
 * as a jolt — the sheet is already still, so the change is the only thing
 * moving. This costs the open nothing: the fade starts *after* the content has
 * committed, so the content lands at the same moment either way, and it runs on
 * the native driver so the commit it follows cannot stall it.
 *
 * The panel is kept mounted underneath and faded out rather than dropped,
 * because content fading up from an empty sheet is the thing being avoided.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Animated, Easing, StyleSheet } from "react-native";

import SheetLoadingPanel from "@/components/sheets/SheetLoadingPanel";
import { SHEET_CONTENT_FADE_MS } from "@/components/sheets/sheet-timing";
import { useAnimatedValue } from "@/hooks/useAnimatedValue";

export default function SheetContentFade({
  label,
  children,
}: {
  /** The panel's label, so the thing being faded out matches what was there. */
  label?: string;
  children: ReactNode;
}) {
  const contentOpacity = useAnimatedValue(0);
  const panelOpacity = useAnimatedValue(1);
  const [isPanelMounted, setIsPanelMounted] = useState(true);

  useEffect(() => {
    // Two frames deep, not one. The commit that mounts this is the expensive
    // one — hundreds of native views — and an animation started inside it
    // spends its first frames blocked, so it arrives already part-way through
    // and jumps. The second frame is the first one on the far side of the
    // build.
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        Animated.parallel([
          Animated.timing(contentOpacity, {
            toValue: 1,
            duration: SHEET_CONTENT_FADE_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
            isInteraction: false,
          }),
          Animated.timing(panelOpacity, {
            toValue: 0,
            duration: SHEET_CONTENT_FADE_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
            isInteraction: false,
          }),
        ]).start(({ finished }) => {
          // Only on a real finish: an interrupted fade means the sheet is on
          // its way out, and unmounting the panel mid-close would show the
          // content jumping to full opacity behind it.
          if (finished) setIsPanelMounted(false);
        });
      });
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      cancelAnimationFrame(innerFrame);
    };
  }, [contentOpacity, panelOpacity]);

  return (
    <Animated.View style={styles.fill}>
      <Animated.View style={[styles.fill, { opacity: contentOpacity }]}>{children}</Animated.View>
      {isPanelMounted ? (
        // Over the content and out of the way of it: a half-faded panel must
        // not eat a tap meant for the buttons appearing underneath it.
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: panelOpacity }]}
          pointerEvents="none"
        >
          <SheetLoadingPanel label={label} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
