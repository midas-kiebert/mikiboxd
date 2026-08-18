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

export async function refreshInfiniteQueryWithFreshSnapshot({
  setSnapshotTime,
}: {
  setSnapshotTime: (snapshotTime: string) => void;
}) {
  const nextSnapshotTime = buildSnapshotTime();
  // The snapshot is part of every showtime/movie query key, so publishing a new
  // one *is* the refetch: the observer moves to a key with no cached pages and
  // fetches from page 0. Nothing here invalidates or trims, and nothing waits
  // for a commit — an earlier version did both, and the wait was the bug. It
  // relied on a double requestAnimationFrame landing after React's commit,
  // which on Android it does not reliably do, so the refetch went out with the
  // previous render's snapshot and the list came back showing showtimes that
  // had already started.
  setSnapshotTime(nextSnapshotTime);
  // The list draws skeletons while the new snapshot's first page is in flight
  // (see ShowtimesScreen), so all this has to do is keep the pull-to-refresh
  // spinner up long enough to be seen when the response is instant.
  await new Promise<void>((resolve) => setTimeout(resolve, MIN_REFRESH_VISIBLE_MS));
  return nextSnapshotTime;
}
