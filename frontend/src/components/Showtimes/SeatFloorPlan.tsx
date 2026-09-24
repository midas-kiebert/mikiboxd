import { Box, Flex, Text } from "@chakra-ui/react"
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
 *
 * Picking a seat is *reported*, not performed: this file draws a room and says
 * which seat was clicked. Saving it is one call away in
 * `useShowtimeSelection`, alongside the status it belongs to, which is what
 * lets a seat pick patch the cached rows instead of refetching every feed.
 * What this file does own is showing the pick immediately — see `pick`.
 *
 * **Opening a panel with a big room in it used to be visibly slow**, and it was
 * three separate things, none of them the obvious one. Measured on Louis
 * Hartlooper's 300-seat LHC 1:
 *
 *   - The seat map's own data arrived 185ms after the click and the seats did
 *     not appear until 337ms. That 152ms was this file: the element the width
 *     is measured from did not exist until the plan had arrived, so measuring
 *     could only *start* then, and a chain of renders and a frame followed
 *     before anything could be laid out. The container is mounted from the
 *     first render now, whether or not there is ever a plan to draw in it, so
 *     the width is known long before the data and the room can be laid out in
 *     the same render that receives it.
 *   - Committing 300 seats costs ~74ms, and it landed in the middle of the
 *     panel's 220ms open animation — which is what actually read as "slow",
 *     since it stalled the column mid-travel and pushed a 325ms animation out
 *     to 411ms. The seats now wait for the first idle frame, so the animation
 *     finishes first and the room fills in behind it.
 *   - The space it will fill is reserved the moment the plan lands, because
 *     the layout maths is cheap (it is only arithmetic) even though drawing
 *     the result is not. Nothing moves when the seats arrive.
 *
 * The ~74ms itself is React's, not the browser's: building these 300 nodes by
 * hand measures 14ms. Which is why the answer here is *when* to commit them
 * rather than a cleverer way to draw them.
 */
import { type MouseEvent, memo, useEffect, useMemo, useState } from "react"
import { useShowtimeSeatFloorPlan } from "shared/hooks/useShowtimeSeatFloorPlan"
import {
  SCREEN_INDICATOR_HEIGHT,
  type ScaledSeat,
  layoutSeatFloorPlan,
} from "shared/showtimes/seat-floor-plan-layout"

type SeatFloorPlanProps = {
  showtimeId: number
  /** The availability reading this plan should agree with. */
  readingAt?: string | null
  /** Set only when the viewer is going, since that is what a seat attaches to. */
  canPickSeat?: boolean
  /**
   * Where the viewer sat down, or `null` to give the seat back — clicking the
   * seat you are already in clears it, the way pressing the status you already
   * hold clears that. Answering `false` puts the pick back: the plan paints it
   * the instant it is clicked, so it needs telling when the write behind it
   * did not land.
   */
  onPickSeat?: (
    seat: { row: string; number: string } | null,
  ) => Promise<boolean> | undefined
}

/** How tall the plan is allowed to get inside the panel. */
const PLAN_HEIGHT = 260

/**
 * The four seat colours, as the CSS custom properties Chakra emits for the
 * `app.seatFree` / `app.seatTaken` / `app.seatFriend` / `app.seatYou` tokens —
 * its standard kebab-case of the token path, confirmed in the page's own
 * stylesheet.
 *
 * Named rather than passed as tokens because seat tiles are plain `<div>`s and
 * not `Box`es (see `SeatTile`). Referencing the variables keeps them following
 * the colour mode exactly as the tokens would.
 */
const SEAT_COLOR = {
  free: "var(--chakra-colors-app-seat-free)",
  taken: "var(--chakra-colors-app-seat-taken)",
  friend: "var(--chakra-colors-app-seat-friend)",
  you: "var(--chakra-colors-app-seat-you)",
} as const

/** Matches the app's own seat corner. */
const SEAT_RADIUS = 4

/** How long the room may wait for an idle frame before it is drawn anyway. */
const IDLE_TIMEOUT_MS = 500
/** The same deadline, for browsers with no idle callback to ask. */
const IDLE_FALLBACK_MS = 300

/** Marks the tiles the delegated click handler below will act on. */
const CLICKABLE_SEAT_CLASS = "seat-tile--clickable"

type SeatTileProps = {
  seat: ScaledSeat
  isYou: boolean
  clickable: boolean
}

/**
 * One seat, as cheap a node as its few hundred siblings can afford.
 *
 * A plain `<div>` with a native `style` object rather than a `Box`, which is
 * the whole reason a big room used to be slow to open. Chakra's style props go
 * through its style engine and end up as a generated class per distinct
 * declaration — and every seat's position is distinct, so a 300-seat room meant
 * 300 trips through that engine and 300 rules injected into the document,
 * inside the one commit that also mounts the rest of the panel. A `style`
 * object is set straight onto the element with no stylesheet involved.
 *
 * Memoised on primitive props, so picking a seat — which flips `isYou` on at
 * most two tiles — re-renders two tiles rather than the whole room. That only
 * holds because the click handler is *not* a prop: it is delegated to the grid
 * (see `handleGridClick`), so there is no per-seat closure to invalidate the
 * comparison on every render.
 *
 * A seat the booking system says is not selectable — the spacers that pad out
 * a room's aisles, and the wheelchair spaces it will not sell online — takes up
 * its slot and paints nothing, which is what the app does. Painting them as
 * free seats is what made The Movies' Zaal 4 read as a broken room: 72 squares
 * for the 52 seats the count beside it was talking about, with the phantom
 * edges of every row bracketing the real ones.
 */
const SeatTile = memo(function SeatTile({
  seat,
  isYou,
  clickable,
}: SeatTileProps) {
  const style: React.CSSProperties = {
    position: "absolute",
    left: seat.x,
    top: seat.y,
    width: seat.scaledWidth,
    height: seat.scaledHeight,
  }

  if (!seat.selectable) {
    return <div style={style} aria-hidden />
  }

  const hasFriend = (seat.friend_count ?? 0) > 0
  const label = `${seat.row_name}${seat.seat_name}`

  return (
    <div
      className={clickable ? `seat-tile ${CLICKABLE_SEAT_CLASS}` : "seat-tile"}
      data-row={seat.row_name}
      data-seat={seat.seat_name}
      style={{
        ...style,
        background: isYou
          ? SEAT_COLOR.you
          : hasFriend
            ? SEAT_COLOR.friend
            : seat.taken
              ? SEAT_COLOR.taken
              : SEAT_COLOR.free,
        borderRadius: SEAT_RADIUS,
        cursor: clickable ? "pointer" : "default",
      }}
      title={
        isYou
          ? `${label} — your seat`
          : hasFriend
            ? `${label} — a friend`
            : seat.taken
              ? `${label} — taken`
              : label
      }
    />
  )
})

const SeatFloorPlan = ({
  showtimeId,
  readingAt = null,
  canPickSeat = false,
  onPickSeat,
}: SeatFloorPlanProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  //
  // The container is held in state rather than a ref, and that is load-bearing:
  // this component renders `null` until its plan arrives, so on the first
  // commit there is no element to measure. A `useRef` plus a mount-only effect
  // therefore measured nothing and never ran again once the room appeared —
  // width stayed 0, `layout` stayed null, and the room was never drawn at all.
  // A state-held node re-runs the effect at the moment the element attaches.
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)

  /**
   * Whether the room may be committed yet.
   *
   * Drawing it is the single most expensive thing the panel does, and until
   * this gate it was doing it while the panel was still sliding open. Waiting
   * for an idle frame says exactly what is meant — "when nothing more urgent
   * is happening" — without this file needing to know that the thing it is
   * yielding to is a width transition two components up. The timeout is the
   * backstop for a tab that never goes idle.
   */
  const [isRoomReady, setIsRoomReady] = useState(false)

  /**
   * The seat the viewer just clicked, shown before the write that saves it has
   * been anywhere near the server.
   *
   * Which seat is "yours" otherwise comes from `is_viewer_seat`, and that is
   * computed per request on a query of its own — so without this, clicking a
   * seat changed nothing on screen until the panel was closed and opened again.
   * While it is set it decides the question outright, which also unmarks
   * whichever seat the server still thinks is yours: there is only ever one.
   *
   * Wrapped one level deep because "no seat" and "not picked anything yet" are
   * different answers and both have to be sayable: the first is what clicking
   * your own seat leaves behind, and it has to win over `is_viewer_seat` in
   * exactly the way a real pick does.
   *
   * No reset effect, because the panel keys its body on the showtime — moving
   * to another screening unmounts this and takes the pick with it.
   */
  const [pick, setPick] = useState<{
    seat: { row: string; number: string } | null
  } | null>(null)

  const { data: plan } = useShowtimeSeatFloorPlan({ showtimeId, readingAt })

  // The panel is resizable and the room has to be re-fitted when it changes,
  // so this measures rather than assuming the panel's nominal width. It runs
  // on mount, not on arrival of the plan, which is the point: by the time the
  // seats are here there is already a width to lay them out against.
  useEffect(() => {
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0
      setWidth(next)
    })
    observer.observe(container)
    setWidth(container.clientWidth)
    return () => observer.disconnect()
  }, [container])

  const layout = useMemo(() => {
    if (!plan?.seats?.length || width === 0) return null
    return layoutSeatFloorPlan(plan.seats, {
      availableWidth: width,
      availableHeight: PLAN_HEIGHT,
    })
  }, [plan, width])

  /**
   * Whether a seat is the viewer's — the local pick while there is one, and
   * what the server last said otherwise.
   */
  const isViewerSeat = (row: string, number: string): boolean => {
    if (pick) return pick.seat?.row === row && pick.seat?.number === number
    return (
      plan?.seats.some(
        (seat) =>
          seat.is_viewer_seat &&
          seat.row_name === row &&
          seat.seat_name === number,
      ) ?? false
    )
  }

  // Hold the room's own commit until the thread is free. `layout` above is
  // already done by this point, so its height can be reserved straight away
  // and nothing shifts when the seats land in it.
  useEffect(() => {
    if (!layout || isRoomReady) return
    if (typeof window.requestIdleCallback !== "function") {
      const timer = setTimeout(() => setIsRoomReady(true), IDLE_FALLBACK_MS)
      return () => clearTimeout(timer)
    }
    const handle = window.requestIdleCallback(() => setIsRoomReady(true), {
      timeout: IDLE_TIMEOUT_MS,
    })
    return () => window.cancelIdleCallback(handle)
  }, [layout, isRoomReady])

  /**
   * Nothing to draw — either the plan is still on its way or, as for most
   * rooms, there is no plan at all. Either way this still mounts the element
   * the width is measured from, at no height and with nothing in it.
   *
   * That is the whole point: measuring can then happen while the request is
   * still in flight instead of only once it has landed, which is what used to
   * put a chain of renders and a frame between the seats arriving and the
   * seats appearing.
   */
  if (!plan?.seats?.length) {
    return <Box ref={setContainer} width="100%" height="0px" />
  }

  const pickSeat = (row: string, number: string) => {
    if (!canPickSeat) return
    const previous = pick
    // Clicking the seat you are already in gives it back, rather than saving
    // the seat you are already saved in. One setting, not a one-way latch —
    // the same rule the three status buttons follow.
    const next = isViewerSeat(row, number) ? null : { row, number }
    setPick({ seat: next })
    const result = onPickSeat?.(next)
    // Put it back if the write failed. `useShowtimeSelection` has already said
    // so with a toast and rolled the feed row back; this is the same undo for
    // the one thing it cannot reach.
    void Promise.resolve(result).then((ok) => {
      if (ok === false) setPick(previous)
    })
  }

  /**
   * One handler for the whole room rather than one per seat.
   *
   * Three hundred inline closures rebuilt on every render is both a cost in
   * itself and the thing that would stop `SeatTile`'s memo from ever holding:
   * a new function per seat per render compares unequal every time.
   */
  const handleGridClick = (event: MouseEvent<HTMLDivElement>) => {
    const tile = (event.target as HTMLElement).closest<HTMLElement>(
      `.${CLICKABLE_SEAT_CLASS}`,
    )
    const row = tile?.dataset.row
    const seat = tile?.dataset.seat
    if (row === undefined || seat === undefined) return
    pickSeat(row, seat)
  }

  // Render/output using the state and derived values prepared above.
  return (
    <Box ref={setContainer} width="100%" mt={3}>
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
        // Sized from `layout` rather than from its contents, so the room's
        // footprint is held from the moment the plan arrives and the seats
        // drop into space that is already theirs.
        <Box
          position="relative"
          height={`${layout.height}px`}
          width={`${layout.width}px`}
          mx="auto"
          // The room's footprint is held from the moment the plan lands, so
          // between then and the idle frame there is a room-shaped blank. One
          // fade on the container — not on each of three hundred seats — makes
          // that read as the room arriving rather than as a hole in the card.
          opacity={isRoomReady ? 1 : 0}
          transition="opacity 140ms ease"
          onClick={handleGridClick}
        >
          {isRoomReady &&
            layout.seats.map((seat) => (
              // Keyed on the room's own geometry, not on the label: row "4" seat
              // "15" and row "41" seat "5" both spell "415", and React quietly
              // dropped one of the two seats.
              <SeatTile
                key={`${seat.row_name}-${seat.seat_name}-${seat.position_left}-${seat.position_top}`}
                seat={seat}
                isYou={isViewerSeat(seat.row_name, seat.seat_name)}
                clickable={canPickSeat && seat.selectable}
              />
            ))}
        </Box>
      ) : null}

      <Flex gap={3} mt={2} wrap="wrap" justify="center">
        {[
          { color: SEAT_COLOR.free, label: "Free" },
          { color: SEAT_COLOR.taken, label: "Taken" },
          { color: SEAT_COLOR.friend, label: "A friend" },
          { color: SEAT_COLOR.you, label: "You" },
        ].map((entry) => (
          <Flex key={entry.label} align="center" gap={1}>
            <Box
              width="9px"
              height="9px"
              borderRadius={`${SEAT_RADIUS}px`}
              bg={entry.color}
            />
            <Text fontSize="2xs" color="fg.muted">
              {entry.label}
            </Text>
          </Flex>
        ))}
      </Flex>

      {canPickSeat ? (
        <Text fontSize="xs" color="fg.muted" mt={2} textAlign="center">
          Click a seat to remember where you are sitting.
        </Text>
      ) : null}
    </Box>
  )
}

export default SeatFloorPlan
