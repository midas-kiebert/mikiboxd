/**
 * Setting your status on a showtime, and your seat in it.
 *
 * Everything a status button needs, so the panel's buttons stay presentational
 * and every screen that offers one behaves the same way.
 *
 * Optimistic on purpose. The round trip is a write plus, on a screening nobody
 * has read yet, a best-effort look at the cinema's ticket shop — long enough
 * that a button which does not move until the answer comes back reads as
 * broken. So the new status is painted into the feed caches immediately, the
 * server's own copy of the row replaces it when it lands, and a failure puts
 * the old row back and says so.
 *
 * What it does *not* do is invalidate `["showtimes"]`. See
 * `showtime-cache.ts`: that prefix covers every page of every feed, and
 * refetching all of them is what made acting on one row feel like a page load.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import type { GoingStatus, ShowtimePublic } from "shared"
import { ShowtimesService } from "shared/client"
import { showtimeSeatAvailabilityQueryKey } from "shared/hooks/useShowtimeSeatAvailability"

import { useRequireAccount } from "@/auth/useSession"
import useCustomToast from "@/hooks/useCustomToast"

import {
  putShowtimeInFeeds,
  refetchStatusScopedFeeds,
} from "./showtime-cache"

/** A seat, or the absence of one — `null` clears whatever was stored. */
export type SeatChoice = {
  row: string | null
  number: string | null
}

type SelectionVariables = {
  status: GoingStatus
  seat?: SeatChoice
  /** The row as it was, to put back if the write fails. */
  previous: ShowtimePublic
}

/**
 * The viewer state a showtime gets the first time a guest-turned-member acts
 * on it, before any payload has carried one.
 */
const NO_VIEWER_STATE_YET = { going: "NOT_GOING" as GoingStatus }

const withStatus = (
  showtime: ShowtimePublic,
  status: GoingStatus,
  seat?: SeatChoice,
): ShowtimePublic => {
  const viewer = showtime.viewer ?? NO_VIEWER_STATE_YET
  // A seat is a note on "I am going". Dropping to interested or not going
  // takes it with it, which is what the backend does too.
  const keepsSeat = status === "GOING"
  // `seat` absent means "leave the seat alone"; `seat` present with nulls in
  // it means "give it back". Those are different answers and `??` cannot tell
  // them apart — written that way, clearing a seat optimistically painted the
  // old one straight back and only took once the server replied.
  const nextSeat = seat ?? {
    row: viewer.seat_row ?? null,
    number: viewer.seat_number ?? null,
  }
  return {
    ...showtime,
    viewer: {
      ...viewer,
      going: status,
      seat_row: keepsSeat ? nextSeat.row : null,
      seat_number: keepsSeat ? nextSeat.number : null,
    },
  }
}

export const useShowtimeSelection = (showtime: ShowtimePublic) => {
  const queryClient = useQueryClient()
  const requireAccount = useRequireAccount()
  const { showErrorToast } = useCustomToast()

  const { mutate, mutateAsync, isPending } = useMutation({
    mutationFn: ({ status, seat }: SelectionVariables) =>
      ShowtimesService.updateShowtimeSelection({
        showtimeId: showtime.id,
        requestBody: {
          going_status: status,
          ...(seat ? { seat_row: seat.row, seat_number: seat.number } : {}),
        },
      }),
    onSuccess: (updated) => {
      putShowtimeInFeeds(queryClient, updated)
      // The row carries its own busyness, and caring about a screening is what
      // sends the backend to go and read it — so this is where "checking…"
      // first appears, without a request of its own.
      if (updated.seat_availability !== undefined) {
        queryClient.setQueryData(
          showtimeSeatAvailabilityQueryKey(updated.id),
          updated.seat_availability,
        )
      }
    },
    onError: (_error, { previous }) => {
      putShowtimeInFeeds(queryClient, previous)
      showErrorToast("Could not save that. Try again.")
    },
    onSettled: () => {
      refetchStatusScopedFeeds(queryClient)
      // A film's page and the films feed both roll every screening's status up
      // into one mark, which no per-showtime patch can compute.
      queryClient.invalidateQueries({ queryKey: ["movie"] })
      queryClient.invalidateQueries({ queryKey: ["movies"] })
    },
  })

  /**
   * Pressing the status you already have clears it, which is how the app's
   * three buttons behave: they are one setting, not three toggles.
   */
  const setStatus = useCallback(
    (status: GoingStatus) => {
      if (!requireAccount()) return
      const next = status === showtime.viewer?.going ? "NOT_GOING" : status
      putShowtimeInFeeds(queryClient, withStatus(showtime, next))
      mutate({ status: next, previous: showtime })
    },
    [mutate, queryClient, requireAccount, showtime],
  )

  /**
   * Answers whether the write landed, which the floor plan needs and the
   * status buttons do not: the plan paints the clicked seat immediately off
   * its own state, so it is the one caller that has something to undo. The
   * toast and the feed rollback still happen in `onError` either way.
   */
  const setSeat = useCallback(
    async (seat: SeatChoice): Promise<boolean> => {
      if (!requireAccount()) return false
      putShowtimeInFeeds(queryClient, withStatus(showtime, "GOING", seat))
      try {
        await mutateAsync({ status: "GOING", seat, previous: showtime })
        return true
      } catch {
        return false
      }
    },
    [mutateAsync, queryClient, requireAccount, showtime],
  )

  return {
    status: showtime.viewer?.going ?? "NOT_GOING",
    setStatus,
    setSeat,
    isPending,
  }
}
