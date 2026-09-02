/**
 * Reads of a showtime's visibility mode ("who can see your status").
 *
 * The showtime sheet has to paint its mode pill the moment it opens, from
 * wherever it was opened, so the mode is cached per showtime before then.
 *
 * Normally it comes with the showtime itself: every list payload carries the
 * viewer's mode for each screening, and the fetch hooks seed it on arrival
 * (`seedShowtimeVisibility`). The batched request is the fallback for
 * showtimes no such payload covered — ids queued within the same short window
 * are coalesced into one request and written under the same keys. The sheet
 * still revalidates on open either way; the cached value only removes the
 * loading state.
 */
import { useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  ShowtimesService,
  type ShowtimeVisibilityPublic,
  type VisibilityMode,
} from "../client";

/**
 * A showtime as a list returns it. `movie` is absent on the shape nested under
 * a movie, which is why the movie id can also be supplied by the caller.
 */
type VisibilityCarrier = {
  id: number;
  movie?: { id: number };
  viewer?: { visibility_mode?: VisibilityMode | null } | null;
};

export const SHOWTIME_VISIBILITY_QUERY_KEY_PREFIX = ["showtimes", "visibility"] as const;

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
 * Cache the modes a list of showtimes already told us about.
 *
 * Every showtime carries the viewer's own mode for it (`viewer.visibility_mode`
 * — see `ShowtimeInMovieViewerState` in `backend/app/schemas/showtime.py`), so
 * a list arrives with the answer the sheet needs. Seeding from the fetch hooks
 * as the page lands means the mode pill is there the instant the sheet opens,
 * rather than after the batched request below has had time to come back.
 *
 * A showtime with no viewer state (a guest, or an older backend) is skipped:
 * there is no mode to speak of, and the prefetch remains the fallback.
 */
export function seedShowtimeVisibility(
  queryClient: QueryClient,
  showtimes: readonly VisibilityCarrier[],
  { movieId }: { movieId?: number } = {}
): void {
  for (const showtime of showtimes) {
    const mode = showtime.viewer?.visibility_mode;
    const resolvedMovieId = showtime.movie?.id ?? movieId;
    if (!mode || resolvedMovieId === undefined) continue;
    queryClient.setQueryData(showtimeVisibilityQueryKey(showtime.id), {
      showtime_id: showtime.id,
      movie_id: resolvedMovieId,
      mode,
    } satisfies ShowtimeVisibilityPublic);
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
