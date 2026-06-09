/**
 * Top-edge safe-area container backed by the synchronous `useSafeAreaInsets()`
 * hook instead of the `SafeAreaView` component.
 *
 * The `SafeAreaView` component applies its inset padding from a native layout
 * pass that lands a frame after mount, so the first painted frame sits too high
 * and then drops into place — a visible flash the first time a screen mounts
 * (most noticeable on lazily-mounted tabs like Agenda/Friends). The hook reads
 * insets synchronously from context (seeded by `initialWindowMetrics` in the
 * root `SafeAreaProvider`), so the very first frame is already correct.
 */
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TopSafeAreaView({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // paddingTop last so it always wins over the passed-in container style.
  return <View style={[style, { paddingTop: insets.top }]}>{children}</View>;
}
