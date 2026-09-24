import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IS_STAGING_BUILD } from '@/constants/api';

// Marks a release build that talks to the staging backend, so a test phone is
// never mistaken for the store app (same bundle id, so it installs over it).
// Draws over everything and takes no touches.
export default function StagingBadge() {
  const insets = useSafeAreaInsets();
  if (!IS_STAGING_BUILD) return null;
  return (
    <View pointerEvents="none" style={[styles.badge, { top: insets.top + 2 }]}>
      <Text style={styles.label}>STAGING</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#D9480F',
    opacity: 0.85,
  },
  label: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
});
