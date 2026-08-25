/**
 * Reads of how full a showtime is.
 *
 * Batched and cached exactly like `useShowtimeVisibility`, and for the same
 * reason: a list of showtimes renders a busyness icon per row, and the sheet
 * has to paint one the moment it opens. Ids queued within a short window are
 * coalesced into one request and seeded into the react-query cache under the
 * per-showtime key both the rows and the sheet read.
 *
 * Two things differ from the visibility hook. The answer is the same for
 * everyone, so it survives signing in and out and does not need refetching on
 * either. And a showtime with no usable reading is *absent* from the response
 * rather than present-with-nulls, so an id that came back empty is cached as
 * `null` explicitly — otherwise every row we know nothing about would be
 * re-requested for ever.
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
  type ShowtimeSeatAvailabilityPublic,
} from "../client";

const SEAT_AVAILABILITY_QUERY_KEY_PREFIX = ["showtimes", "seatAvailability"] as const;

export const showtimeSeatAvailabilityQueryKey = (showtimeId: number | null) =>
  [...SEAT_AVAILABILITY_QUERY_KEY_PREFIX, showtimeId] as const;

// Prefetched entries have no observer until a row or the sheet reads them.
const SEAT_AVAILABILITY_GC_TIME_MS = 30 * 60 * 1000;
// Seat counts move on the order of minutes at worst, so a list scrolled back
// past does not need re-reading; the sheet revalidates on open regardless.
const SEAT_AVAILABILITY_STALE_TIME_MS = 5 * 60 * 1000;
const BATCH_WINDOW_MS = 50;
const MAX_IDS_PER_REQUEST = 100;

type BatchState = {
  queuedIds: Set<number>;
  inFlightIds: Set<number>;
  timer: ReturnType<typeof setTimeout> | null;
};

const batchStateByClient = new WeakMap<QueryClient, BatchState>();

function getBatchState(queryClient: QueryClient): BatchState {
  const existing = batchStateByClient.get(queryClient);
  if (existing) return existing;

  queryClient.setQueryDefaults(SEAT_AVAILABILITY_QUERY_KEY_PREFIX, {
    gcTime: SEAT_AVAILABILITY_GC_TIME_MS,
  });
  const state: BatchState = {
    queuedIds: new Set(),
    inFlightIds: new Set(),
    timer: null,
  };
  batchStateByClient.set(queryClient, state);
  return state;
}

async function fetchSeatAvailabilityChunk(
  queryClient: QueryClient,
  state: BatchState,
  showtimeIds: number[]
): Promise<void> {
  for (const showtimeId of showtimeIds) state.inFlightIds.add(showtimeId);
  try {
    const availabilities = await ShowtimesService.getSeatAvailabilityBatch({
      showtimeIds,
    });
    const known = new Set(availabilities.map((a) => a.showtime_id));
    for (const availability of availabilities) {
      queryClient.setQueryData(
        showtimeSeatAvailabilityQueryKey(availability.showtime_id),
        availability
      );
    }
    // The ones the server had nothing to say about. Caching the "nothing"
    // is what stops them being asked for again on every render.
    for (const showtimeId of showtimeIds) {
      if (known.has(showtimeId)) continue;
      queryClient.setQueryData(showtimeSeatAvailabilityQueryKey(showtimeId), null);
    }
  } catch {
    // Best effort: the sheet fetches its own showtime when it opens.
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
    void fetchSeatAvailabilityChunk(
      queryClient,
      state,
      showtimeIds.slice(start, start + MAX_IDS_PER_REQUEST)
    );
  }
}

/**
 * Queue showtimes whose seat availability should be cached before anything
 * renders it. Ids already cached or in flight are skipped, so this is cheap to
 * call on every render of a list.
 */
export function prefetchShowtimeSeatAvailability(
  queryClient: QueryClient,
  showtimeIds: readonly number[]
): void {
  const state = getBatchState(queryClient);
  const now = Date.now();
  for (const showtimeId of showtimeIds) {
    if (state.inFlightIds.has(showtimeId)) continue;
    // Age rather than mere presence, because the cached value is often the
    // `null` meaning "nothing read yet". Skipping on presence alone would pin
    // that null for the whole cache lifetime, and a showtime someone just
    // marked interested — which is exactly what triggers its first reading —
    // would never get its badge.
    const cachedAt = queryClient.getQueryState(
      showtimeSeatAvailabilityQueryKey(showtimeId)
    )?.dataUpdatedAt;
    if (cachedAt && now - cachedAt < SEAT_AVAILABILITY_STALE_TIME_MS) continue;
    state.queuedIds.add(showtimeId);
  }

  if (state.queuedIds.size === 0 || state.timer !== null) return;
  state.timer = setTimeout(() => flushBatch(queryClient), BATCH_WINDOW_MS);
}

/**
 * Prefetch seat availability for the showtimes a screen currently renders.
 * Use it in any list that shows the busyness icon or opens the showtime sheet.
 */
export function usePrefetchShowtimeSeatAvailability(
  showtimeIds: readonly number[],
  { enabled = true }: { enabled?: boolean } = {}
): void {
  const queryClient = useQueryClient();
  // The joined ids are both the payload and the effect's dependency, so this
  // re-runs exactly when the rendered set changes, not on every render.
  const showtimeIdsKey = showtimeIds.join(",");

  useEffect(() => {
    if (!enabled || showtimeIdsKey.length === 0) return;
    prefetchShowtimeSeatAvailability(
      queryClient,
      showtimeIdsKey.split(",").map(Number)
    );
  }, [showtimeIdsKey, enabled, queryClient]);
}

/**
 * Read a showtime's availability from the prefetch cache without ever fetching
 * it. For list rows: a row that shows an icon must not be able to turn a
 * screenful of showtimes into a screenful of requests. It still re-renders when
 * the batch lands, because seeding the cache notifies observers either way.
 */
export function useCachedShowtimeSeatAvailability(
  showtimeId: number | null
): ShowtimeSeatAvailabilityPublic | null {
  const { data } = useQuery<ShowtimeSeatAvailabilityPublic | null, Error>({
    queryKey: showtimeSeatAvailabilityQueryKey(showtimeId),
    enabled: false,
    queryFn: () =>
      ShowtimesService.getSeatAvailability({ showtimeId: showtimeId as number }),
    gcTime: SEAT_AVAILABILITY_GC_TIME_MS,
  });
  return data ?? null;
}

// While the sheet is open, availability is live rather than a one-off read —
// marking interest sends the backend to look at the seat count, and the poller
// re-reads a busy screening every quarter hour — and nobody should have to
// reopen the app to see either. The open interval is the worst case for
// noticing that a reading has landed; the checking one is what a visible
// "checking..." resolves at, and applies whenever the server says a read is
// due, whoever asked for it.
const SEAT_AVAILABILITY_OPEN_POLL_MS = 15 * 1000;
const SEAT_AVAILABILITY_CHECKING_POLL_MS = 3 * 1000;

export function useShowtimeSeatAvailability({
  showtimeId,
  enabled = true,
}: {
  showtimeId: number | null;
  enabled?: boolean;
}): UseQueryResult<ShowtimeSeatAvailabilityPublic | null, Error> {
  return useQuery<ShowtimeSeatAvailabilityPublic | null, Error>({
    queryKey: showtimeSeatAvailabilityQueryKey(showtimeId),
    enabled: enabled && showtimeId !== null,
    queryFn: () =>
      ShowtimesService.getSeatAvailability({ showtimeId: showtimeId as number }),
    staleTime: SEAT_AVAILABILITY_STALE_TIME_MS,
    gcTime: SEAT_AVAILABILITY_GC_TIME_MS,
    refetchOnMount: "always",
    refetchInterval: enabled
      ? (query) =>
          query.state.data?.checking
            ? SEAT_AVAILABILITY_CHECKING_POLL_MS
            : SEAT_AVAILABILITY_OPEN_POLL_MS
      : false,
    refetchIntervalInBackground: false,
  });
}
