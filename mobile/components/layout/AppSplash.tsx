/**
 * Branded loading overlay that bridges the native OS splash and the app shell.
 *
 * It renders identically to the native splash (logo centred on a solid white /
 * black background, matching the system scheme) so the hand-off is seamless,
 * then stays up — covering the auth check, theme resolution and initial data
 * fetches — until the parent reports the app is ready, at which point it fades
 * out to reveal a fully-assembled shell instead of one that visibly loads in
 * chunks.
 *
 * It is intentionally decoupled from the app's (async) theme preference so it
 * never recolours mid-display.
 */
import { useEffect, useRef } from 'react';
import { Animated, Appearance, Easing, StyleSheet } from 'react-native';

// Mirrors the native splash background colours configured in app.json.
const SPLASH_LIGHT_BG = '#ffffff';
const SPLASH_DARK_BG = '#000000';

type AppSplashProps = {
  /** While true the splash stays up; when it flips to false the splash fades out. */
  active: boolean;
  /** Called once the fade-out finishes so the parent can unmount the splash. */
  onHidden: () => void;
  /** Fired on first paint so the parent can hide the native OS splash underneath. */
  onReady?: () => void;
};

export default function AppSplash({ active, onHidden, onReady }: AppSplashProps) {
  const opacity = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const backgroundColor =
    Appearance.getColorScheme() === 'dark' ? SPLASH_DARK_BG : SPLASH_LIGHT_BG;

  // Gentle logo pulse while loading.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Fade out once no longer active, then notify the parent to unmount us.
  useEffect(() => {
    if (active) return;
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: 320,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) onHidden();
    });
    return () => animation.stop();
  }, [active, opacity, onHidden]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.container, { backgroundColor, opacity }]}
      pointerEvents={active ? 'auto' : 'none'}
      onLayout={onReady}
    >
      <Animated.Image
        source={require('../../assets/images/splash-icon.png')}
        style={[styles.logo, { transform: [{ scale }] }]}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  logo: {
    width: 160,
    height: 160,
  },
});
