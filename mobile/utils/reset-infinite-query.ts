/**
 * Utility helper for mobile feature logic: Reset infinite query.
 */
import { DateTime } from "luxon";
import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";

const SNAPSHOT_TIME_ZONE = "Europe/Amsterdam";
const SNAPSHOT_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSS";

export async function resetInfiniteQuery<T>(queryClient: QueryClient, queryKey: QueryKey) {
  // This is useful for pull-to-refresh flows on infinite lists.
  // Keep only the first page so pull-to-refresh starts from a clean pagination baseline.
  queryClient.setQueryData<InfiniteData<T>>(queryKey, (data) => {
    if (!data || data.pages.length === 0) return data;

    return {
      pages: [data.pages[0]],
      pageParams: [data.pageParams[0] ?? 0],
    };
  });

  // Trigger a refetch after trimming cached pages.
  await queryClient.invalidateQueries({ queryKey });
}

export function buildSnapshotTime() {
  return DateTime.now().setZone(SNAPSHOT_TIME_ZONE).toFormat(SNAPSHOT_TIME_FORMAT);
}

export async function refreshInfiniteQueryWithFreshSnapshot<T>({
  queryClient,
  queryKey,
  setSnapshotTime,
}: {
  queryClient: QueryClient;
  queryKey: QueryKey;
  setSnapshotTime: (snapshotTime: string) => void;
}) {
  const nextSnapshotTime = buildSnapshotTime();
  setSnapshotTime(nextSnapshotTime);
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  await resetInfiniteQuery<T>(queryClient, queryKey);
  return nextSnapshotTime;
}
