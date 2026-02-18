/**
 * Shared mobile UI component: Haptic tab.
 */
import { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import * as Haptics from 'expo-haptics';

export function HapticTab(props: BottomTabBarButtonProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        // iOS haptics feel natural for tab presses; Android already has native ripple feedback.
        if (process.env.EXPO_OS === 'ios') {
          // Add a soft haptic feedback when pressing down on the tabs.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        props.onPressIn?.(ev);
      }}
    />
  );
}
