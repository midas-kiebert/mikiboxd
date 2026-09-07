/**
 * How full the room is, in the detail panel.
 *
 * Three things the website had none of: the busyness level the poller has
 * already worked out, a way to ask for a fresh reading, and a watch that tells
 * you when a ticket frees up on a sold-out screening.
 *
 * The wording comes from `shared/showtimes/seat-availability-level`, the same
 * copy the app's badge uses. Levels are handed down by the backend and never
 * recomputed here — the client is told a level and picks how to draw it.
 *
 * Nothing renders at all for a showtime whose cinema we cannot read seats from,
 * which is most of them: `trackable === false` means "never readable", not
 * "unknown yet", and a permanent "no data" row is worse than no row.
 */
import { Badge, Button, Flex, Stack, Text } from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { SeatAvailabilityLevel } from "shared"
import { ShowtimesService } from "shared/client"
import {
  showtimeSeatAvailabilityQueryKey,
  useShowtimeSeatAvailability,
} from "shared/hooks/useShowtimeSeatAvailability"
import {
  formatCheckedAtShort,
  formatSeatCount,
  getSeatAvailabilityCopy,
} from "shared/showtimes/seat-availability-level"

import { useIsSignedIn, useRequireAccount } from "@/auth/useSession"
import SeatFloorPlan from "@/components/Showtimes/SeatFloorPlan"

type SeatAvailabilitySectionProps = {
  showtimeId: number
  /** True when the viewer is going, which is what a seat attaches to. */
  isGoing?: boolean
}

/**
 * Which Chakra palette draws a level. The ramp ends on two reds so the two
 * states that actually cost you a ticket are the loudest marks on screen —
 * the same ordering the app's badge uses.
 */
const LEVEL_PALETTE: Record<string, string> = {
  some_taken: "teal",
  busy: "yellow",
  very_busy: "orange",
  last_few: "red",
  sold_out: "red",
}

const soldOutWatchQueryKey = ["showtimes", "sold-out-watch"] as const

const SeatAvailabilitySection = ({
  showtimeId,
  isGoing = false,
}: SeatAvailabilitySectionProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const queryClient = useQueryClient()
  const requireAccount = useRequireAccount()
  const isSignedIn = useIsSignedIn()

  const { data: availability } = useShowtimeSeatAvailability({ showtimeId })

  // A guest has no watch to read, and asking 401s on every refetch.
  const { data: watch } = useQuery({
    queryKey: soldOutWatchQueryKey,
    queryFn: () => ShowtimesService.getSoldOutWatch(),
    enabled: isSignedIn,
    staleTime: 60_000,
  })

  const { mutate: check, isPending: isChecking } = useMutation({
    mutationFn: () =>
      ShowtimesService.requestSeatAvailabilityCheck({ showtimeId }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(
        showtimeSeatAvailabilityQueryKey(showtimeId),
        fresh,
      )
    },
  })

  const { mutate: startWatch } = useMutation({
    mutationFn: () => ShowtimesService.startSoldOutWatch({ showtimeId }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: soldOutWatchQueryKey }),
  })

  const { mutate: stopWatch } = useMutation({
    mutationFn: () => ShowtimesService.stopSoldOutWatch(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: soldOutWatchQueryKey }),
  })

  // `trackable === false` is "this cinema never tells us", which is different
  // from "we have not looked yet" — gate on `=== false` so a missing flag on an
  // older payload does not hide the section.
  if (availability?.trackable === false) return null
  if (!availability) return null

  const copy = availability.level
    ? getSeatAvailabilityCopy(availability.level as SeatAvailabilityLevel)
    : null
  const seatCount = formatSeatCount(availability)
  const checkedAt = formatCheckedAtShort(availability.checked_at)
  const isWatching = watch?.showtime_id === showtimeId

  const handleCheck = () => {
    if (!requireAccount()) return
    check()
  }

  const handleWatch = () => {
    if (!requireAccount()) return
    if (isWatching) stopWatch()
    else startWatch()
  }

  // Render/output using the state and derived values prepared above.
  return (
    <Stack gap={2}>
      <Text fontSize="sm" fontWeight="semibold" color="fg.muted">
        Seats
      </Text>

      {copy ? (
        <Flex align="center" gap={2} wrap="wrap">
          <Badge colorPalette={LEVEL_PALETTE[copy.level] ?? "gray"}>
            {copy.label}
          </Badge>
          {seatCount ? <Text fontSize="sm">{seatCount}</Text> : null}
        </Flex>
      ) : null}

      {copy ? (
        <Text fontSize="xs" color="fg.muted">
          {copy.description}
          {checkedAt ? ` · ${checkedAt}` : ""}
        </Text>
      ) : (
        <Text fontSize="xs" color="fg.muted">
          Nobody has checked this screening yet.
        </Text>
      )}

      {/* Passed the same reading the count above came from, so the map and the
          number cannot disagree. */}
      <SeatFloorPlan
        showtimeId={showtimeId}
        readingAt={availability.checked_at ?? null}
        canPickSeat={isGoing}
      />

      <Flex gap={2} wrap="wrap">
        {availability.can_request_check ? (
          <Button
            size="xs"
            variant="surface"
            loading={isChecking || availability.checking}
            onClick={handleCheck}
          >
            Check how many seats are left
          </Button>
        ) : null}

        {/* Offered only where a returned ticket is the thing you are waiting
            for; on a screening with seats left it would mean nothing. */}
        {availability.watchable && availability.level === "sold_out" ? (
          <Button
            size="xs"
            variant={isWatching ? "solid" : "surface"}
            colorPalette={isWatching ? "green" : "gray"}
            onClick={handleWatch}
          >
            {isWatching
              ? "Stop watching for a returned ticket"
              : "Tell me if a ticket frees up"}
          </Button>
        ) : null}
      </Flex>
    </Stack>
  )
}

export default SeatAvailabilitySection
