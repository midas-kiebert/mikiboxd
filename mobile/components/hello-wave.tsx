/**
 * Shared mobile UI component: Hello wave.
 */
import Animated from 'react-native-reanimated';

export function HelloWave() {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  // This uses RN animated text keyframes for a quick, playful onboarding accent.
  return (
    <Animated.Text
      style={{
        fontSize: 28,
        lineHeight: 32,
        marginTop: -6,
        animationName: {
          '50%': { transform: [{ rotate: '25deg' }] },
        },
        animationIterationCount: 4,
        animationDuration: '300ms',
      }}>
      👋
    </Animated.Text>
  );
}
