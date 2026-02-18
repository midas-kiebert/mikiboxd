/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ThemeColors = typeof Colors.light;
type StringColorKey = {
  [K in keyof ThemeColors]: ThemeColors[K] extends string ? K : never
}[keyof ThemeColors];

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: StringColorKey
): string {
  // Read current light/dark mode so we pick the right token set.
  const theme = useColorScheme() ?? 'light';
  // Optional prop override wins over theme token lookup.
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    // Fall back to the theme palette when no override is provided.
    return Colors[theme][colorName];
  }
}

// Returns the full colors object for the current theme, default light
export function useThemeColors() {
  // Return the full color palette for the active theme.
  const theme = useColorScheme() ?? 'light';
  return Colors[theme];
}
