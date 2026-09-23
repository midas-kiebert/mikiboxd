/**
 * How full the room is, where you are sitting, and where to buy a ticket —
 * folded into one card, the way the app folds them.
 *
 * They were three separate blocks here and are one there for a good reason:
 * "how full is it", "where am I sitting" and "where do I buy one" are the same
 * decision, taken in that order. A card with none of the three renders nothing,
 * because a row of dashes where a real answer sometimes appears is worse than
 * the answer simply not being there.
 *
 * Levels are handed down by the backend and never recomputed here; the wording,
 * the icon and the palette are all `shared/showtimes/seat-availability-level`,
 * so a level cannot be described or marked differently on the two clients.
 *
 * The check button is the part that used to look broken, and the fix is two
 * things done together:
 *
 *   - `checking` is painted the moment the button is pressed rather than when
 *     the request returns. The server says the same thing back a beat later —
 *     the due time it writes is what `checking` is derived from — so this is
 *     the real answer arriving early, not a placeholder for it. Without it the
 *     button simply *vanished* on press, because the server turns
 *     `can_request_check` off as soon as a read is pending, and nothing took
 *     its place.
 *   - The working state keeps the button's own footprint, so the row does not
 *     reflow the moment the press lands — the app's arrangement exactly.
 *
 * The fresh reading is also written back into the feed rows, so the busyness
 * badge in the list agrees with the panel instead of holding whatever the last
 * page fetch happened to carry.
 */
import { Box, Flex, Image, Input, Spinner, Text } from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useEffect, useState } from "react"
import type { ShowtimePublic } from "shared"
import { MeService, ShowtimesService } from "shared/client"
import type { ShowtimeSeatAvailabilityPublic } from "shared/client"
import {
  showtimeSeatAvailabilityQueryKey,
  useShowtimeSeatAvailability,
} from "shared/hooks/useShowtimeSeatAvailability"
import {
  formatCheckedAtShort,
  formatSeatCount,
  getSeatAvailabilityCopy,
  getSeatAvailabilityPresentation,
} from "shared/showtimes/seat-availability-level"
import {
  getSeatFieldMaxLength,
  getSeatInputConfig,
  validateSeatFieldValue,
} from "shared/showtimes/seat-input"
import { formatSeatLabel } from "shared/showtimes/seat-label"

import { useIsSignedIn, useRequireAccount } from "@/auth/useSession"
import SeatFloorPlan from "@/components/Showtimes/SeatFloorPlan"
import {
  PANEL_ROW_LABEL_SIZE,
  PANEL_ROW_VALUE_SIZE,
  PanelActionButton,
  PanelAnchor,
  PanelPressable,
} from "@/components/Showtimes/detail/PanelChrome"
import {
  PanelIcon,
  SEAT_LEVEL_ICON,
} from "@/components/Showtimes/detail/panel-icons"
import { copyCinevilleCardForTicketLink } from "@/features/cineville/cineville-card"
import { putShowtimeInFeeds } from "@/features/showtimes/showtime-cache"
import { useShowtimeSelection } from "@/features/showtimes/useShowtimeSelection"
import useCustomToast from "@/hooks/useCustomToast"
import Logo from "/assets/images/mikino-logo.png"

/**
 * Outside the `["showtimes"]` prefix on purpose: this is one row on the
 * account, not a fact about any screening, and living under that prefix meant
 * every feed invalidation dragged it along.
 */
const soldOutWatchQueryKey = ["soldOutWatch"] as const

/**
 * The MiKiNO mark on the ticket row, which is a ticket — the app puts the same
 * image here, and a picture of the thing beats an outbound-link glyph that
 * would only repeat the chevron at the other end.
 *
 * Three numbers rather than one because the file is mostly empty: the ticket is
 * 770x460 inside a 1024-square transparent canvas, so a contained box renders
 * the ticket at 75% of its width and 45% of its height. `TICKET_MARK_CANVAS` is
 * what the box has to be for the ticket to come out at the size below it.
 */
const TICKET_MARK_HEIGHT = 18
const TICKET_MARK_CANVAS = Math.round(TICKET_MARK_HEIGHT / (460 / 1024))
const TICKET_MARK_WIDTH = Math.round(TICKET_MARK_CANVAS * (770 / 1024))
const TICKET_MARK_BOX = `${TICKET_MARK_CANVAS}px`

/** The pill the level, the Check button and the "?" all share a footprint in. */
const ValuePill = ({
  bg,
  color,
  children,
}: {
  bg: string
  color: string
  children: ReactNode
}) => (
  <Flex
    align="center"
    justify="center"
    gap="4px"
    flexShrink={0}
    minH="26px"
    minW="26px"
    px="9px"
    borderRadius="full"
    bg={bg}
    color={color}
    fontSize={PANEL_ROW_VALUE_SIZE}
    fontWeight="700"
    lineHeight="1"
  >
    {children}
  </Flex>
)

/** One tappable line in the card's lower half — the ticket link and the seat. */
const CardRow = ({
  divided,
  children,
  ...rest
}: {
  divided: boolean
  children: ReactNode
  onClick?: () => void
  href?: string
}) => {
  const style = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    w: "100%",
    px: "10px",
    py: "8px",
    borderTopWidth: divided ? "1px" : 0,
    borderColor: "border.muted",
    bg: "transparent",
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "background-color 120ms ease",
    _hover: { bg: "bg.subtle" },
    _focusVisible: {
      outline: "2px solid",
      outlineColor: "app.tint",
      outlineOffset: "-2px",
    },
  }

  if (rest.href) {
    return (
      <PanelAnchor
        href={rest.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={rest.onClick}
        {...style}
      >
        {children}
      </PanelAnchor>
    )
  }

  return (
    <PanelPressable type="button" onClick={rest.onClick} {...style}>
      {children}
    </PanelPressable>
  )
}

type SeatAvailabilityPanelProps = {
  showtime: ShowtimePublic
}

const SeatAvailabilityPanel = ({ showtime }: SeatAvailabilityPanelProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const showtimeId = showtime.id
  const queryClient = useQueryClient()
  const requireAccount = useRequireAccount()
  const isSignedIn = useIsSignedIn()
  const { showErrorToast } = useCustomToast()

  const { data: availability } = useShowtimeSeatAvailability({ showtimeId })
  // Sitting somewhere is part of the same selection as going, so it takes the
  // same optimistic path rather than a mutation of its own that refetched
  // every feed on each click.
  const { setSeat } = useShowtimeSelection(showtime)

  const [isEditingSeat, setIsEditingSeat] = useState(false)
  const [rowDraft, setRowDraft] = useState("")
  const [numberDraft, setNumberDraft] = useState("")

  // A seat editor left open over one screening has nothing to do with the next.
  useEffect(() => {
    setIsEditingSeat(false)
  }, [showtimeId])

  // The account either has the sold-out watch or it does not; there is no tier
  // to show and no upsell, so a viewer without it sees no control at all.
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: MeService.getCurrentUser,
    enabled: isSignedIn,
    staleTime: 5 * 60_000,
  })

  const { data: watch } = useQuery({
    queryKey: soldOutWatchQueryKey,
    queryFn: () => ShowtimesService.getSoldOutWatch(),
    enabled: isSignedIn && Boolean(currentUser?.can_watch_sold_out),
    staleTime: 60_000,
  })

  /**
   * Keep the row in the feed in step with the panel.
   *
   * The busyness badge on a card reads the `seat_availability` its page was
   * fetched with, so without this the list would keep showing "Busy" next to a
   * panel that already says "Sold out" until something refetched the feed —
   * which is precisely the "reload the page to see it" this section is fixing.
   */
  useEffect(() => {
    if (availability === undefined) return
    if (showtime.seat_availability === availability) return
    putShowtimeInFeeds(queryClient, {
      ...showtime,
      seat_availability: availability,
    })
  }, [availability, queryClient, showtime])

  const { mutate: check } = useMutation({
    mutationFn: () =>
      ShowtimesService.requestSeatAvailabilityCheck({ showtimeId }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(
        showtimeSeatAvailabilityQueryKey(showtimeId),
        fresh,
      )
    },
    onError: () => {
      // Nothing to roll back by hand: the optimistic "checking" is only ever a
      // guess at what the server is about to say, so re-asking it is both the
      // undo and the retry.
      queryClient.invalidateQueries({
        queryKey: showtimeSeatAvailabilityQueryKey(showtimeId),
      })
      showErrorToast("Could not reach the ticket shop.")
    },
  })

  const { mutate: setWatch } = useMutation({
    mutationFn: (wanted: boolean): Promise<unknown> =>
      wanted
        ? ShowtimesService.startSoldOutWatch({ showtimeId })
        : ShowtimesService.stopSoldOutWatch(),
    onError: () => showErrorToast("Could not change that watch."),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: soldOutWatchQueryKey }),
  })

  const level = availability?.level ?? null
  const copy = level ? getSeatAvailabilityCopy(level) : null
  const presentation = level ? getSeatAvailabilityPresentation(level) : null
  const isChecking = Boolean(availability?.checking)

  // `trackable === false` is "this cinema never tells us", which is different
  // from "we have not looked yet" — gate on `=== false` so a missing flag on
  // an older payload does not hide the row. False while the query is still
  // loading too, in which case a ticket link alone can still justify the card
  // but not a premature claim above it.
  const showBusyness =
    isChecking ||
    Boolean(copy) ||
    (availability?.trackable !== false && Boolean(availability))

  const seating = showtime.cinema?.seating?.trim().toLowerCase() ?? ""
  const seatConfig = getSeatInputConfig(seating)
  const seatLabel = formatSeatLabel(
    showtime.viewer?.seat_row,
    showtime.viewer?.seat_number,
  )
  const showSeatRow = showtime.viewer?.going === "GOING" && seating !== "free"
  const hasTicketLink = Boolean(showtime.ticket_link)

  if (!showBusyness && !hasTicketLink && !showSeatRow) return null

  const seatCount = availability ? formatSeatCount(availability) : null
  const checkedAt = formatCheckedAtShort(availability?.checked_at)
  const isWatching = watch?.showtime_id === showtimeId
  const canWatch =
    Boolean(currentUser?.can_watch_sold_out) &&
    Boolean(availability?.watchable) &&
    level === "sold_out"

  const handleCheck = () => {
    if (!requireAccount()) return
    // Painted before the request rather than after it: the reading takes a few
    // seconds at the ticket shop, and a control that looks untouched for that
    // long reads as broken.
    queryClient.setQueryData<ShowtimeSeatAvailabilityPublic | null>(
      showtimeSeatAvailabilityQueryKey(showtimeId),
      (previous) =>
        previous
          ? { ...previous, checking: true, can_request_check: false }
          : previous,
    )
    check()
  }

  const openSeatEditor = () => {
    if (!requireAccount()) return
    setRowDraft(showtime.viewer?.seat_row ?? "")
    setNumberDraft(showtime.viewer?.seat_number ?? "")
    setIsEditingSeat(true)
  }

  const rowError = validateSeatFieldValue(
    rowDraft || null,
    seatConfig.rowKind,
    "Row",
  )
  const numberError = validateSeatFieldValue(
    numberDraft || null,
    seatConfig.seatKind,
    "Seat",
  )
  // Row and seat are set or cleared together — a half-filled pair is an edit in
  // progress, not a mistake worth calling out, so it just blocks Save.
  const isSeatPairIncomplete = Boolean(rowDraft) !== Boolean(numberDraft)

  const saveSeat = () => {
    if (rowError || numberError || isSeatPairIncomplete) return
    setSeat({ row: rowDraft || null, number: numberDraft || null })
    setIsEditingSeat(false)
  }

  // Render/output using the state and derived values prepared above.
  return (
    <Box px={3} pb={3}>
      <Box
        borderWidth="1px"
        borderColor="border"
        borderRadius="10px"
        overflow="hidden"
      >
        {showBusyness ? (
          <Flex align="center" gap="8px" px="10px" py="8px">
            <Box flex="1" minW={0}>
              <Text
                fontSize={PANEL_ROW_LABEL_SIZE}
                fontWeight="700"
                lineHeight="1.3"
              >
                Available seats
              </Text>
              {/* A re-read in flight keeps the number that is already there —
                  blanking a good answer while a fresher one is fetched is worse
                  than showing it a few seconds stale — and says so where the
                  timestamp normally sits. */}
              <Text
                fontSize={PANEL_ROW_VALUE_SIZE}
                color="fg.subtle"
                lineHeight="1.4"
                truncate
              >
                {isChecking
                  ? "Checking now…"
                  : checkedAt
                    ? checkedAt
                    : availability?.can_request_check
                      ? "Not tracked yet"
                      : "No count available"}
              </Text>
            </Box>

            {copy && presentation ? (
              <ValuePill
                bg={`app.${presentation.palette}.primary`}
                color={`app.${presentation.palette}.secondary`}
              >
                <Box
                  as={SEAT_LEVEL_ICON[presentation.icon]}
                  boxSize="15px"
                  aria-label={copy.label}
                />
                {seatCount != null ? (
                  <Box as="span" position="relative" top="1px">
                    {seatCount}
                  </Box>
                ) : null}
              </ValuePill>
            ) : isChecking ? (
              // Same footprint as the Check button, so the row does not reflow
              // the moment the press lands — just its "press me" fill swapped
              // for a disabled, working one.
              <ValuePill bg="app.tint" color="app.pillActiveText">
                <Spinner size="xs" borderWidth="2px" />
              </ValuePill>
            ) : availability?.can_request_check ? (
              <PanelPressable
                type="button"
                onClick={handleCheck}
                aria-label={
                  isSignedIn
                    ? "Check how many seats are left"
                    : "Log in to check how many seats are left"
                }
                display="flex"
                alignItems="center"
                justifyContent="center"
                gap="4px"
                flexShrink={0}
                minH="26px"
                px="9px"
                borderRadius="full"
                bg="app.tint"
                color="app.pillActiveText"
                fontSize={PANEL_ROW_VALUE_SIZE}
                fontWeight="700"
                lineHeight="1"
                cursor="pointer"
                transition="background-color 120ms ease"
                _hover={{ bg: "app.green.secondary" }}
                _focusVisible={{
                  outline: "2px solid",
                  outlineColor: "app.tint",
                  outlineOffset: "1px",
                }}
              >
                <Box as={PanelIcon.search} boxSize="15px" aria-hidden />
                <Box as="span" position="relative" top="1px">
                  {isSignedIn ? "Check" : "Log in to check"}
                </Box>
              </PanelPressable>
            ) : checkedAt ? (
              // Read once, and the ticket shop had nothing usable to say.
              // Nothing to offer here — asking again is what the poller is for.
              <ValuePill bg="app.surfaceMuted" color="fg.muted">
                <Box
                  as={PanelIcon.helpOutline}
                  boxSize="15px"
                  aria-label="No count available"
                />
              </ValuePill>
            ) : null}

            {/* Offered only where a returned ticket is the thing you are waiting
                for; on a screening with seats left it would mean nothing. */}
            {canWatch ? (
              <PanelPressable
                type="button"
                aria-pressed={isWatching}
                aria-label={
                  isWatching
                    ? "Stop watching for a returned ticket"
                    : "Tell me if a ticket frees up"
                }
                title={
                  isWatching
                    ? "Stop watching for a returned ticket"
                    : "Tell me if a ticket frees up"
                }
                onClick={() => {
                  if (!requireAccount()) return
                  setWatch(!isWatching)
                }}
                display="flex"
                alignItems="center"
                justifyContent="center"
                flexShrink={0}
                boxSize="24px"
                borderRadius="full"
                bg="transparent"
                color={isWatching ? "app.green.secondary" : "fg.muted"}
                cursor="pointer"
                transition="background-color 120ms ease, color 120ms ease"
                _hover={{ bg: "bg.subtle" }}
                _focusVisible={{
                  outline: "2px solid",
                  outlineColor: "app.tint",
                  outlineOffset: "1px",
                }}
              >
                <Box
                  as={
                    isWatching
                      ? PanelIcon.notificationsActive
                      : PanelIcon.notificationsNone
                  }
                  boxSize="20px"
                />
              </PanelPressable>
            ) : null}
          </Flex>
        ) : null}

        {/* Passed the same reading the count above came from, so the map and the
            number cannot disagree. Most rooms have no plan at all, in which case
            it draws nothing. Held back until a reading actually exists — before
            that there is nothing for the map to agree with, only a guess. */}
        {showBusyness && checkedAt ? (
          <Box px="10px" pb="2px">
            <SeatFloorPlan
              showtimeId={showtimeId}
              readingAt={availability?.checked_at ?? null}
              canPickSeat={showtime.viewer?.going === "GOING"}
              // `null` is the plan saying the viewer clicked their own seat,
              // which gives it back rather than saving it again.
              onPickSeat={(seat) =>
                setSeat({
                  row: seat?.row ?? null,
                  number: seat?.number ?? null,
                })
              }
            />
          </Box>
        ) : null}

        {/* Get ticket first — it is an outside link, ordered and styled as the
            leaving-the-site action it is. The seat comes after, since setting it
            is normally what you do once you are back with a seat number in
            hand. It deliberately does not borrow the ticket row's look: a tint
            label and a chevron both read as "this navigates somewhere", which is
            wrong for a field you fill in without going anywhere — so it is
            quieter and ends in an edit affordance instead of a chevron. */}
        {hasTicketLink ? (
          <CardRow
            divided={showBusyness}
            href={showtime.ticket_link ?? undefined}
            // The app's auto-copy: the saved Cineville card goes on the
            // clipboard on the way out, ready to paste at the ticket shop.
            onClick={() =>
              copyCinevilleCardForTicketLink(
                Boolean(showtime.cinema?.cineville),
              )
            }
          >
            {/* The brand mark is a ticket, which is what the app puts on this
                row too — a picture of the thing, where an outbound-link glyph
                would only repeat the chevron at the other end. Decorative: the
                row already says "Get ticket". */}
            {/* Sized for the ticket, not for the file. The mark is a 770x460
                ticket centred on a 1024-square transparent canvas, so a
                contained box draws it at 45% of that box's height — an 18px
                box gives an 8px ticket, which is why it looked lost beside a
                14px label. The box is sized so the *ticket* lands at ~18px and
                the empty canvas around it is pulled back out with negative
                margins, leaving the row its own height. */}
            <Image
              src={Logo}
              alt=""
              boxSize={TICKET_MARK_BOX}
              my={`-${(TICKET_MARK_CANVAS - TICKET_MARK_HEIGHT) / 2}px`}
              mx={`-${(TICKET_MARK_CANVAS - TICKET_MARK_WIDTH) / 2}px`}
              objectFit="contain"
              flexShrink={0}
              alignSelf="center"
            />
            <Text
              fontSize={PANEL_ROW_LABEL_SIZE}
              fontWeight="700"
              color="app.tint"
              flex="1"
              minW={0}
              position="relative"
              top="1px"
            >
              Get ticket
            </Text>
            <Box
              as={PanelIcon.chevronRight}
              boxSize="18px"
              color="app.tint"
              aria-hidden
            />
          </CardRow>
        ) : null}

        {showSeatRow && !isEditingSeat ? (
          <CardRow
            divided={showBusyness || hasTicketLink}
            onClick={openSeatEditor}
          >
            <Box
              as={PanelIcon.eventSeat}
              boxSize="15px"
              flexShrink={0}
              color={seatLabel ? "app.green.secondary" : "fg.muted"}
              aria-hidden
            />
            <Text
              fontSize={PANEL_ROW_LABEL_SIZE}
              fontWeight={seatLabel ? "700" : "500"}
              color={seatLabel ? "app.green.secondary" : "fg.muted"}
              flex="1"
              minW={0}
              truncate
              position="relative"
              top="1px"
            >
              {seatLabel ? `Seat ${seatLabel}` : "Set your seat"}
            </Text>
            <Box
              as={seatLabel ? PanelIcon.edit : PanelIcon.addCircleOutline}
              boxSize="15px"
              flexShrink={0}
              color={seatLabel ? "app.green.secondary" : "app.tint"}
              aria-hidden
            />
          </CardRow>
        ) : null}

        {showSeatRow && isEditingSeat ? (
          <Box
            px="10px"
            py="8px"
            borderTopWidth={showBusyness || hasTicketLink ? "1px" : 0}
            borderColor="border.muted"
          >
            <Text fontSize="12px" fontWeight="700" mb="6px">
              Seat info
            </Text>
            <Flex gap="6px">
              <Input
                size="sm"
                fontSize="13px"
                placeholder="Row"
                aria-label="Row"
                value={rowDraft}
                maxLength={getSeatFieldMaxLength(seatConfig.rowKind)}
                onChange={(event) => setRowDraft(event.target.value)}
              />
              <Input
                size="sm"
                fontSize="13px"
                placeholder="Seat"
                aria-label="Seat"
                value={numberDraft}
                maxLength={getSeatFieldMaxLength(seatConfig.seatKind)}
                onChange={(event) => setNumberDraft(event.target.value)}
              />
            </Flex>
            {rowError || numberError ? (
              <Text
                fontSize="11px"
                color="app.red.secondary"
                mt="4px"
                lineHeight="1.4"
              >
                {rowError ?? numberError}
              </Text>
            ) : null}
            <Flex gap="6px" mt="8px">
              <PanelActionButton
                primary
                fullWidth
                disabled={Boolean(
                  rowError || numberError || isSeatPairIncomplete,
                )}
                onClick={saveSeat}
              >
                Save
              </PanelActionButton>
              <PanelActionButton onClick={() => setIsEditingSeat(false)}>
                Cancel
              </PanelActionButton>
            </Flex>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

export default SeatAvailabilityPanel
