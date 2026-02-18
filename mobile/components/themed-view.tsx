/**
 * Shared mobile UI component: Themed view.
 */
import { View, type ViewProps } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
};

export function ThemedView({ style, lightColor, darkColor, ...otherProps }: ThemedViewProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  // Mirrors ThemedText behavior but for background surfaces.
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  // Render/output using the state and derived values prepared above.
  return <View style={[{ backgroundColor }, style]} {...otherProps} />;
}
