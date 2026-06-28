import { RefreshControl, type RefreshControlProps } from 'react-native';

import { useThemeColors } from '@/hooks/use-theme-color';

/**
 * RefreshControl pre-wired with the app's theme colors so the pull-to-refresh
 * spinner is clearly visible on both light and dark backgrounds. Plain
 * RefreshControl renders a near-invisible gray spinner on the dark theme.
 */
export function ThemedRefreshControl(props: RefreshControlProps) {
  const colors = useThemeColors();

  return (
    <RefreshControl
      tintColor={colors.tint}
      colors={[colors.tint]}
      progressBackgroundColor={colors.cardBackground}
      {...props}
    />
  );
}
