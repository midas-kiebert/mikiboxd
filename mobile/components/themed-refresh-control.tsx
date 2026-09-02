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

/**
 * Spread onto any scrollable that carries a {@link ThemedRefreshControl}, and
 * pair with {@link pullToRefreshContentStyle} on its `contentContainerStyle`.
 *
 * A list with only a row or two otherwise answers the pull gesture over its
 * rows and nowhere else: with nothing to scroll, the empty space below the
 * last row is dead, so a pull started low on the screen does nothing. The
 * bounce is what makes the gesture available there, and the grown content
 * container is what puts that space inside the list's own content rather than
 * behind it.
 */
export const pullToRefreshScrollProps = { alwaysBounceVertical: true } as const;

/** Merged into a refreshable list's `contentContainerStyle` — see {@link pullToRefreshScrollProps}. */
export const pullToRefreshContentStyle = { flexGrow: 1 } as const;
