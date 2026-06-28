/**
 * Utility helper for mobile feature logic: Reset infinite query.
 */
import { DateTime } from "luxon";
import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";

const SNAPSHOT_TIME_ZONE = "Europe/Amsterdam";
const SNAPSHOT_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSS";

// Minimum time a pull-to-refresh stays in its loading state, even when the
// network responds instantly (e.g. nothing changed / served from cache). Without
// this the spinner and skeletons can flash by too fast to register, so a refresh
// that did run looks like it did nothing.
const MIN_REFRESH_VISIBLE_MS = 450;

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
  // Wait for the snapshot state update to render AND commit before refetching.
  // The query fetches with `snapshotTime` captured from the render closure, so
  // invalidating before the commit lands refetches with the stale snapshot —
  // that's the "had to pull twice" bug. A double rAF reliably fires after
  // React's commit, so the refetch always uses the fresh snapshot.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  // Hold the loading state for at least MIN_REFRESH_VISIBLE_MS so the refetch is
  // always visibly obvious, even when it completes instantly.
  const minVisible = new Promise<void>((resolve) =>
    setTimeout(resolve, MIN_REFRESH_VISIBLE_MS)
  );
  await Promise.all([resetInfiniteQuery<T>(queryClient, queryKey), minVisible]);
  return nextSnapshotTime;
}
