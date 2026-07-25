/**
 * Reads of a showtime's visibility mode ("who can see your status").
 *
 * The showtime sheet has to paint its mode pill the moment it opens, from
 * wherever it was opened. Screens that can open the sheet therefore prefetch
 * the modes of the showtimes they render: ids queued within the same short
 * window are coalesced into a single batched request and seeded straight into
 * the react-query cache under the per-showtime key the sheet reads. The sheet
 * still revalidates on open — the seeded value only removes the loading state.
 */
import { useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { ShowtimesService, type ShowtimeVisibilityPublic } from "../client";

const SHOWTIME_VISIBILITY_QUERY_KEY_PREFIX = ["showtimes", "visibility"] as const;

export const showtimeVisibilityQueryKey = (showtimeId: number | null) =>
  [...SHOWTIME_VISIBILITY_QUERY_KEY_PREFIX, showtimeId] as const;

// Prefetched entries have no observer until the sheet opens, so they need a
// generous garbage-collection window to still be there when it does.
const VISIBILITY_GC_TIME_MS = 30 * 60 * 1000;
// Long enough to coalesce a list's rows into one request, short enough that a
// sheet opened right away still benefits from it.
const BATCH_WINDOW_MS = 50;
// Keeps a single request's URL (and the work behind it) bounded; the server
// rejects larger batches.
const MAX_IDS_PER_REQUEST = 100;

type BatchState = {
  /** Ids waiting for the current window to close. */
  queuedIds: Set<number>;
  /** Ids already requested but not yet cached, so they aren't re-queued. */
  inFlightIds: Set<number>;
  timer: ReturnType<typeof setTimeout> | null;
};

const batchStateByClient = new WeakMap<QueryClient, BatchState>();

function getBatchState(queryClient: QueryClient): BatchState {
  const existing = batchStateByClient.get(queryClient);
  if (existing) return existing;

  queryClient.setQueryDefaults(SHOWTIME_VISIBILITY_QUERY_KEY_PREFIX, {
    gcTime: VISIBILITY_GC_TIME_MS,
  });
  const state: BatchState = {
    queuedIds: new Set(),
    inFlightIds: new Set(),
    timer: null,
  };
  batchStateByClient.set(queryClient, state);
  return state;
}

async function fetchVisibilityChunk(
  queryClient: QueryClient,
  state: BatchState,
  showtimeIds: number[]
): Promise<void> {
  for (const showtimeId of showtimeIds) state.inFlightIds.add(showtimeId);
  try {
    const visibilities = await ShowtimesService.getShowtimeVisibilityBatch({
      showtimeIds,
    });
    for (const visibility of visibilities) {
      queryClient.setQueryData(
        showtimeVisibilityQueryKey(visibility.showtime_id),
        visibility
      );
    }
  } catch {
    // Best effort: the sheet fetches the mode itself when it opens.
  } finally {
    for (const showtimeId of showtimeIds) state.inFlightIds.delete(showtimeId);
  }
}

function flushBatch(queryClient: QueryClient): void {
  const state = getBatchState(queryClient);
  state.timer = null;
  const showtimeIds = [...state.queuedIds];
  state.queuedIds.clear();

  for (let start = 0; start < showtimeIds.length; start += MAX_IDS_PER_REQUEST) {
    void fetchVisibilityChunk(
      queryClient,
      state,
      showtimeIds.slice(start, start + MAX_IDS_PER_REQUEST)
    );
  }
}

/**
 * Queue showtimes whose visibility mode should already be cached by the time
 * the sheet opens. Ids that are cached or already in flight are skipped, so
 * this is cheap to call on every render of a list.
 */
export function prefetchShowtimeVisibility(
  queryClient: QueryClient,
  showtimeIds: readonly number[]
): void {
  const state = getBatchState(queryClient);
  for (const showtimeId of showtimeIds) {
    if (state.inFlightIds.has(showtimeId)) continue;
    const cached = queryClient.getQueryData(showtimeVisibilityQueryKey(showtimeId));
    if (cached !== undefined) continue;
    state.queuedIds.add(showtimeId);
  }

  if (state.queuedIds.size === 0 || state.timer !== null) return;
  state.timer = setTimeout(() => flushBatch(queryClient), BATCH_WINDOW_MS);
}

/**
 * Prefetch the visibility modes of the showtimes a screen currently renders.
 * Use it in any list whose rows open the showtime sheet.
 */
export function usePrefetchShowtimeVisibility(
  showtimeIds: readonly number[],
  { enabled = true }: { enabled?: boolean } = {}
): void {
  const queryClient = useQueryClient();
  // The joined ids are both the payload and the effect's dependency, so the
  // prefetch re-runs exactly when the rendered set of showtimes changes
  // (and not on every render, as a fresh array prop would).
  const showtimeIdsKey = showtimeIds.join(",");

  useEffect(() => {
    if (!enabled || showtimeIdsKey.length === 0) return;
    prefetchShowtimeVisibility(queryClient, showtimeIdsKey.split(",").map(Number));
  }, [showtimeIdsKey, enabled, queryClient]);
}

export function useShowtimeVisibility({
  showtimeId,
  enabled = true,
}: {
  showtimeId: number | null;
  enabled?: boolean;
}): UseQueryResult<ShowtimeVisibilityPublic, Error> {
  return useQuery<ShowtimeVisibilityPublic, Error>({
    queryKey: showtimeVisibilityQueryKey(showtimeId),
    enabled: enabled && showtimeId !== null,
    queryFn: () =>
      ShowtimesService.getShowtimeVisibility({ showtimeId: showtimeId as number }),
    // Prefetched data paints immediately; this still revalidates on open.
    staleTime: 0,
    gcTime: VISIBILITY_GC_TIME_MS,
  });
}
