/**
 * Whether a showtime's room has a floor plan, and its last seat map if so.
 *
 * Unlike `useShowtimeSeatAvailability` this has no list-wide badge to feed, so
 * there is no batching — only the sheet ever reads it, once, when "set your
 * seat" becomes relevant. `null` covers both "still loading" and "this room
 * has no floor plan" the same way the seat-availability hook already treats
 * "nothing to say" as `null` rather than an error.
 *
 * The taken/free flags come from the availability poller's last reading, not
 * from a live request to the cinema — `seats_checked_at` says how old they
 * are. This used to read the booking system on every sheet open, which put
 * the seat picker outside the very cadence that keeps that traffic bounded.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ShowtimesService, type SeatFloorPlanPublic } from "../client";

const SEAT_FLOOR_PLAN_QUERY_KEY_PREFIX = ["showtimes", "seatFloorPlan"] as const;

export const showtimeSeatFloorPlanQueryKey = (showtimeId: number | null) =>
  [...SEAT_FLOOR_PLAN_QUERY_KEY_PREFIX, showtimeId] as const;

// The seats only change when the poller reads this showtime again, so there
// is nothing a shorter window could catch. `refetchOnMount: "always"` still
// re-reads on every open, which is what keeps the viewer's own seat and
// friends' seats — the parts that do change between opens — current.
const SEAT_FLOOR_PLAN_STALE_TIME_MS = 5 * 60 * 1000;
const SEAT_FLOOR_PLAN_GC_TIME_MS = 30 * 60 * 1000;

export function useShowtimeSeatFloorPlan({
  showtimeId,
  enabled = true,
}: {
  showtimeId: number | null;
  enabled?: boolean;
}): UseQueryResult<SeatFloorPlanPublic | null, Error> {
  return useQuery<SeatFloorPlanPublic | null, Error>({
    queryKey: showtimeSeatFloorPlanQueryKey(showtimeId),
    enabled: enabled && showtimeId !== null,
    queryFn: () =>
      ShowtimesService.getShowtimeSeatmap({ showtimeId: showtimeId as number }),
    staleTime: SEAT_FLOOR_PLAN_STALE_TIME_MS,
    gcTime: SEAT_FLOOR_PLAN_GC_TIME_MS,
    refetchOnMount: "always",
  });
}
