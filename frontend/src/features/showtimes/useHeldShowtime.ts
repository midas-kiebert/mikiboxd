/**
 * The showtime a page's panel is open on, held apart from the feed it came
 * from — see `HELD_SHOWTIME_KEY` in `showtime-cache.ts` for why.
 *
 * `hold` on selection; `held` is that row as the cache has it now, patched by
 * every status write like any feed's copy.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import type { ShowtimePublic } from "shared"

import { HELD_SHOWTIME_KEY, type HeldShowtimeData } from "./showtime-cache"

export const useHeldShowtime = () => {
  const queryClient = useQueryClient()
  // Never fetched: the entry only ever holds what `hold` put in it. A disabled
  // query still re-renders on `setQueryData`, which is all this needs.
  const { data } = useQuery<HeldShowtimeData | null>({
    queryKey: HELD_SHOWTIME_KEY,
    queryFn: () => null,
    enabled: false,
  })

  const hold = useCallback(
    (showtime: ShowtimePublic) => {
      queryClient.setQueryData<HeldShowtimeData>(HELD_SHOWTIME_KEY, {
        held: showtime,
      })
    },
    [queryClient],
  )

  return { held: data?.held ?? null, hold }
}
