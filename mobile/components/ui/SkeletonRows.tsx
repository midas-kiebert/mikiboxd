import { View } from 'react-native';

import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Generic row-card placeholders for list loading/refresh states. Used so a
 * pull-to-refresh visibly reloads the list (cards clear to skeletons and back)
 * even when the refetched data is unchanged.
 */
export function SkeletonRows({
  count = 5,
  height = 112,
  borderRadius = 12,
  gap = 16,
}: {
  count?: number;
  height?: number;
  borderRadius?: number;
  gap?: number;
}) {
  return (
    <View>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton
          key={index}
          style={{
            height,
            borderRadius,
            marginBottom: index === count - 1 ? 0 : gap,
          }}
        />
      ))}
    </View>
  );
}
