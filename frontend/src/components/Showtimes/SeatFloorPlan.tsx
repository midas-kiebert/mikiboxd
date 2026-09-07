/**
 * The room, drawn.
 *
 * Every bit of the geometry — fitting the room to the space, capping seat size
 * so a 31-seat room does not render as a zoomed-in fragment, insetting seats so
 * pitch-to-pitch rooms do not read as one solid block — is
 * `shared/showtimes/seat-floor-plan-layout`, the same code the app runs. This
 * file measures its container, hands those two numbers over, and paints what
 * comes back.
 *
 * The taken/free flags come from the availability poller's last reading rather
 * than a live request to the cinema, so the map is exactly as fresh as the seat
 * count beside it — which is why `readingAt` is passed through: a plan and a
 * count that disagree would be worse than either alone.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Box, Flex, Text } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ShowtimesService } from "shared/client"
import { useShowtimeSeatFloorPlan } from "shared/hooks/useShowtimeSeatFloorPlan"
import {
  SCREEN_INDICATOR_HEIGHT,
  layoutSeatFloorPlan,
} from "shared/showtimes/seat-floor-plan-layout"

import { useRequireAccount } from "@/auth/useSession"

type SeatFloorPlanProps = {
  showtimeId: number
  /** The availability reading this plan should agree with. */
  readingAt?: string | null
  /** Set only when the viewer is going, since that is what a seat attaches to. */
  canPickSeat?: boolean
}

/** How tall the plan is allowed to get inside the panel. */
const PLAN_HEIGHT = 260

const SeatFloorPlan = ({
  showtimeId,
  readingAt = null,
  canPickSeat = false,
}: SeatFloorPlanProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const queryClient = useQueryClient()
  const requireAccount = useRequireAccount()

  const { data: plan } = useShowtimeSeatFloorPlan({ showtimeId, readingAt })

  // The panel is resizable and the room has to be re-fitted when it changes,
  // so this measures rather than assuming the panel's nominal width.
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0
      setWidth(next)
    })
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(() => {
    if (!plan?.seats?.length || width === 0) return null
    return layoutSeatFloorPlan(plan.seats, {
      availableWidth: width,
      availableHeight: PLAN_HEIGHT,
    })
  }, [plan, width])

  const { mutate: setSeat } = useMutation({
    mutationFn: (seat: { row: string; number: string }) =>
      ShowtimesService.updateShowtimeSelection({
        showtimeId,
        requestBody: {
          going_status: "GOING",
          seat_row: seat.row,
          seat_number: seat.number,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["showtimes"] })
    },
  })

  // `null` covers both "still loading" and "this room has no floor plan", which
  // is most rooms — nothing is drawn either way.
  if (!plan?.seats?.length) return null

  const handleSeat = (rowName: string, seatName: string, selectable: boolean) => {
    if (!canPickSeat || !selectable) return
    if (!requireAccount()) return
    setSeat({ row: rowName, number: seatName })
  }

  // Render/output using the state and derived values prepared above.
  return (
    <Box ref={containerRef} width="100%">
      {/* No screen geometry comes from the cinema, so this is purely an
          orientation cue — which way the room faces. */}
      <Flex
        align="center"
        justify="center"
        height={`${SCREEN_INDICATOR_HEIGHT}px`}
        borderBottomWidth="2px"
        borderColor="fg.subtle"
        mb={2}
      >
        <Text
          fontSize="2xs"
          letterSpacing="0.2em"
          color="fg.muted"
          textTransform="uppercase"
        >
          Screen
        </Text>
      </Flex>

      {layout ? (
        <Box
          position="relative"
          height={`${layout.height}px`}
          width={`${layout.width}px`}
          mx="auto"
        >
          {layout.seats.map((seat) => {
            const isYou = seat.is_viewer_seat
            const hasFriend = (seat.friend_count ?? 0) > 0
            const background = isYou
              ? "app.seatYou"
              : hasFriend
                ? "app.seatFriend"
                : seat.taken
                  ? "app.seatTaken"
                  : "app.seatFree"

            const label = `${seat.row_name}${seat.seat_name}`
            const clickable = canPickSeat && seat.selectable && !seat.taken

            return (
              <Box
                key={label}
                position="absolute"
                left={`${seat.x}px`}
                top={`${seat.y}px`}
                width={`${seat.scaledWidth}px`}
                height={`${seat.scaledHeight}px`}
                bg={background}
                borderRadius="1px"
                cursor={clickable ? "pointer" : "default"}
                title={
                  isYou
                    ? `${label} — your seat`
                    : hasFriend
                      ? `${label} — a friend`
                      : seat.taken
                        ? `${label} — taken`
                        : label
                }
                onClick={() =>
                  handleSeat(seat.row_name, seat.seat_name, seat.selectable)
                }
              />
            )
          })}
        </Box>
      ) : null}

      <Flex gap={3} mt={2} wrap="wrap" justify="center">
        {[
          { color: "app.seatFree", label: "Free" },
          { color: "app.seatTaken", label: "Taken" },
          { color: "app.seatFriend", label: "A friend" },
          { color: "app.seatYou", label: "You" },
        ].map((entry) => (
          <Flex key={entry.label} align="center" gap={1}>
            <Box width="9px" height="9px" borderRadius="1px" bg={entry.color} />
            <Text fontSize="2xs" color="fg.muted">
              {entry.label}
            </Text>
          </Flex>
        ))}
      </Flex>

      {canPickSeat ? (
        <Text fontSize="xs" color="fg.muted" mt={2} textAlign="center">
          Click a free seat to remember where you are sitting.
        </Text>
      ) : null}
    </Box>
  )
}

export default SeatFloorPlan
