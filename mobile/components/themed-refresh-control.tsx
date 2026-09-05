import { useCallback } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';

import { useThemeColors } from '@/hooks/use-theme-color';
import { triggerImpactHaptic } from '@/utils/long-press';

/**
 * RefreshControl pre-wired with the app's theme colors so the pull-to-refresh
 * spinner is clearly visible on both light and dark backgrounds. Plain
 * RefreshControl renders a near-invisible gray spinner on the dark theme.
 *
 * It also answers the gesture. `onRefresh` fires the moment the pull crosses
 * the threshold and the finger lets go, which is exactly the moment the pull
 * became a refresh — so the buzz belongs here rather than in any one screen's
 * handler. Every refreshable list in the app goes through this component, so
 * one call covers all of them and a new screen cannot forget it.
 */
export function ThemedRefreshControl({ onRefresh, ...props }: RefreshControlProps) {
  const colors = useThemeColors();

  const handleRefresh = useCallback(() => {
    triggerImpactHaptic();
    onRefresh?.();
  }, [onRefresh]);

  return (
    <RefreshControl
      tintColor={colors.tint}
      colors={[colors.tint]}
      progressBackgroundColor={colors.cardBackground}
      {...props}
      onRefresh={handleRefresh}
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
