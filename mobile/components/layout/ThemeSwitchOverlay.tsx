/**
 * The curtain over a theme change.
 *
 * Re-theming re-renders every mounted screen, which on a loaded feed takes long
 * enough to watch happen — rows recolouring in waves, the tab bar last. This
 * covers that: it comes down on the tap, the new palette is applied underneath
 * it (see `utils/theme-preference.ts`), and it lifts once the app has settled.
 *
 * Painted in the palette the app is switching *to*, so it lifts onto a screen
 * the colour it already was rather than flashing the old theme's background on
 * its way out.
 *
 * What is inside is the shared {@link LoadingLogo} panel, so this wait looks
 * like every other wait in the app. The two fades here are single
 * native-driven timings, marked `isInteraction: false` so they do not hold the
 * interaction handle the store waits on to decide the app has settled.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

import LoadingLogo from '@/components/layout/LoadingLogo';
import { Colors } from '@/constants/theme';
import {
  getPendingScheme,
  useIsThemeSwitching,
  THEME_SWITCH_FADE_IN_MS,
  THEME_SWITCH_FADE_OUT_MS,
} from '@/utils/theme-preference';

export default function ThemeSwitchOverlay() {
  const isSwitching = useIsThemeSwitching();
  // The scheme being switched to, captured when the curtain goes up. Null while
  // there is nothing to cover, which is nearly always.
  const [cover, setCover] = useState<'light' | 'dark' | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isSwitching) {
      setCover(getPendingScheme());
      const fadeIn = Animated.timing(opacity, {
        toValue: 1,
        duration: THEME_SWITCH_FADE_IN_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
        isInteraction: false,
      });
      fadeIn.start();
      return () => fadeIn.stop();
    }
    if (cover === null) return;
    const fadeOut = Animated.timing(opacity, {
      toValue: 0,
      duration: THEME_SWITCH_FADE_OUT_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
      isInteraction: false,
    });
    fadeOut.start(({ finished }) => {
      if (finished) setCover(null);
    });
    return () => fadeOut.stop();
  }, [isSwitching, cover, opacity]);

  if (cover === null) return null;

  const palette = Colors[cover];

  return (
    <Animated.View
      testID="theme-switch-overlay"
      style={[
        StyleSheet.absoluteFill,
        styles.container,
        { backgroundColor: palette.background, opacity },
      ]}
      // Taps land on whatever is underneath once the curtain is on its way out,
      // but never while it is covering a screen that is still re-rendering.
      pointerEvents={isSwitching ? 'auto' : 'none'}
      accessibilityRole="progressbar"
      accessibilityLabel="Switching theme"
    >
      <LoadingLogo
        label="Switching theme…"
        tintColor={palette.tint}
        labelColor={palette.textSecondary}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    // Above the splash: a theme change during a cold start is unlikely, but the
    // curtain is the newer of the two and must not end up under it.
    zIndex: 10000,
  },
});
