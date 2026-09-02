/**
 * Utility helper for mobile feature logic: Reset infinite query.
 */
import { useCallback, useEffect, useState } from "react";
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
  // A floor, not the whole wait — see `useSnapshotRefresh`, which holds the
  // refresh open until the new snapshot's page has actually landed. This only
  // keeps the spinner up long enough to be seen when the response is instant.
  await new Promise<void>((resolve) => setTimeout(resolve, MIN_REFRESH_VISIBLE_MS));
  return nextSnapshotTime;
}

/**
 * Owns the `refreshing` flag behind a pull-to-refresh, for the feeds whose
 * refresh is a new snapshot.
 *
 * Held for as long as the refresh really lasts, which is the point of it.
 * Publishing a snapshot moves the query to a key with nothing cached, so for
 * the whole of the refetch the list is *empty* and the query reports
 * `isLoading` — indistinguishable, from the outside, from a cold first load.
 * Every "don't do this during a refresh" rule in the app keys off `refreshing`
 * (above all: never put the loading panel up for one — see `ListLoadingLogo`),
 * and when this flag dropped at a fixed 450ms those rules came off while the
 * refresh was still visibly running. A slow feed then flashed the panel up
 * mid-refresh.
 *
 * `isFetching` is the whole query's flag, so a `fetchNextPage` racing a
 * refresh would extend it. That needs a list to be paginated while it is
 * empty, which is not a thing the user can do.
 */
export function useSnapshotRefresh({
  setSnapshotTime,
  isFetching,
}: {
  setSnapshotTime: (snapshotTime: string) => void;
  /** The refreshed query's own fetching flag. */
  isFetching: boolean;
}) {
  const [refreshing, setRefreshing] = useState(false);
  // Cleared at the *start* of every refresh, which is what stops the effect
  // below ending one before the floor has passed — that floor is also the
  // window the new snapshot key needs to be picked up, before `isFetching`
  // has had any chance to go true. Its initial value is never read: nothing
  // is refreshing at mount, so the effect's `!refreshing` guard wins.
  const [minVisibleElapsed, setMinVisibleElapsed] = useState(true);

  const handleRefresh = useCallback(async () => {
    setMinVisibleElapsed(false);
    setRefreshing(true);
    await refreshInfiniteQueryWithFreshSnapshot({ setSnapshotTime });
    setMinVisibleElapsed(true);
  }, [setSnapshotTime]);

  useEffect(() => {
    if (!refreshing || !minVisibleElapsed || isFetching) return;
    setRefreshing(false);
  }, [refreshing, minVisibleElapsed, isFetching]);

  return { refreshing, handleRefresh };
}
