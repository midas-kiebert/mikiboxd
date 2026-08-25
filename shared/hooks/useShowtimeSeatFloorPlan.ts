/**
 * Whether a showtime's room has a floor plan, and its live seat map if so.
 *
 * Unlike `useShowtimeSeatAvailability` this has no list-wide badge to feed, so
 * there is no batching — only the sheet ever reads it, once, when "set your
 * seat" becomes relevant. `null` covers both "still loading" and "this room
 * has no floor plan" the same way the seat-availability hook already treats
 * "nothing to say" as `null` rather than an error.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ShowtimesService, type SeatFloorPlanPublic } from "../client";

const SEAT_FLOOR_PLAN_QUERY_KEY_PREFIX = ["showtimes", "seatFloorPlan"] as const;

export const showtimeSeatFloorPlanQueryKey = (showtimeId: number | null) =>
  [...SEAT_FLOOR_PLAN_QUERY_KEY_PREFIX, showtimeId] as const;

// A room's layout is effectively permanent, but live taken/free status is not
// — short enough that reopening the sheet a minute later shows fresh seats,
// long enough that toggling status/interest fields doesn't re-fetch it.
const SEAT_FLOOR_PLAN_STALE_TIME_MS = 20 * 1000;
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
