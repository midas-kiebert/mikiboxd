/**
 * The busyness badge on a feed row.
 *
 * Reads `showtime.seat_availability`, which the showtime payloads already
 * carry — no extra request per row.
 *
 * The calmest level draws nothing here. The badge exists to say "hurry if you
 * want a ticket", and "Nearly empty" is the absence of that, so on a dense list
 * it costs a glance and says nothing; the panel still shows every level,
 * because there the seat count is the information.
 */
import { Badge } from "@chakra-ui/react"
import type { ShowtimeSeatAvailabilityPublic } from "shared"
import {
  getSeatAvailabilityCopy,
  isUrgentSeatAvailabilityLevel,
} from "shared/showtimes/seat-availability-level"

const LEVEL_PALETTE: Record<string, string> = {
  some_taken: "teal",
  busy: "yellow",
  very_busy: "orange",
  last_few: "red",
  sold_out: "red",
}

type SeatAvailabilityBadgeProps = {
  availability?: ShowtimeSeatAvailabilityPublic | null
}

const SeatAvailabilityBadge = ({
  availability,
}: SeatAvailabilityBadgeProps) => {
  const level = availability?.level
  if (!level || !isUrgentSeatAvailabilityLevel(level)) return null

  const copy = getSeatAvailabilityCopy(level)
  if (!copy) return null

  return (
    <Badge size="sm" colorPalette={LEVEL_PALETTE[level] ?? "gray"}>
      {copy.label}
    </Badge>
  )
}

export default SeatAvailabilityBadge
