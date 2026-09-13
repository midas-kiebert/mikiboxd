/**
 * The panel that opens beside the feed when a showtime is selected.
 *
 * Docked rather than a centred dialog, which is the one real advantage the web
 * has over the app's full-screen sheet: the list stays visible, so acting on
 * one screening never hides the alternatives you were comparing it against.
 *
 * Everything else follows the app's sheet, in its order and its words: the
 * header with "More info" under the poster, then who is already here, then the
 * status buttons, then one card holding the seat count, the ticket link and
 * your seat, then "Status visible to", then who you have invited, and Share and
 * "Invite friends" at the foot. The web had reached the same set of features by
 * a different arrangement, and the two clients disagreeing about where a thing
 * lives — and about whether a status is a star or a bookmark — costs more than
 * either layout was worth. The one deliberate difference is Share, which copies
 * a link here instead of opening a share sheet.
 *
 * Three decisions shape it:
 *
 *   - **It paints from data already in hand.** Every section reads the
 *     `ShowtimePublic` the feed fetched — attendance, the invite state, the
 *     visibility mode and the busyness are all on it — so selecting a row is
 *     instant and the follow-up queries only ever *revalidate* what is already
 *     drawn. Nothing here has a loading state on the way in.
 *   - **It reacts to the selection.** The card is topped with the status's own
 *     colour, the body animates on each change of screening, and the panel
 *     scrolls back to its top: with rows this alike, a panel that changed
 *     silently halfway down its own scroll was easy to mistake for the one you
 *     were just looking at.
 *   - **Acting on it does not reload the feed.** Status changes patch the
 *     cached rows in place (`features/showtimes/showtime-cache`) instead of
 *     invalidating `["showtimes"]`, which used to refetch every page of every
 *     feed on every press.
 *
 * The header is sticky inside the panel's own scroller, which is why the panel
 * paints its own card and its own padding rather than taking them from
 * `FeedLayout` — a sticky header needs a background of its own to pin against.
 */
import { Box, Text } from "@chakra-ui/react"
import { useEffect, useRef } from "react"
import type { ShowtimePublic } from "shared"

import { useIsSignedIn, useRequireAccount } from "@/auth/useSession"
import SeatAvailabilityPanel from "@/components/Showtimes/detail/SeatAvailabilityPanel"
import {
  PanelIconButton,
  PanelPressable,
} from "@/components/Showtimes/detail/PanelChrome"
import { PanelIcon } from "@/components/Showtimes/detail/panel-icons"
import ShowtimeAttendance from "@/components/Showtimes/detail/ShowtimeAttendance"
import ShowtimeDetailHeader from "@/components/Showtimes/detail/ShowtimeDetailHeader"
import ShowtimeStatusControl from "@/components/Showtimes/detail/ShowtimeStatusControl"
import ShowtimeVisibilityPanel from "@/components/Showtimes/detail/ShowtimeVisibilityPanel"
import { SIDE_PANEL_SCROLLER_ATTRIBUTE } from "@/components/Feed/FeedLayout"
import { useShowtimeSelection } from "@/features/showtimes/useShowtimeSelection"

type ShowtimeDetailPanelProps = {
  showtime: ShowtimePublic
  onClose: () => void
}

const ShowtimeDetailPanel = ({ showtime, onClose }: ShowtimeDetailPanelProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const showtimeId = showtime.id
  const isSignedIn = useIsSignedIn()
  const requireAccount = useRequireAccount()
  const rootRef = useRef<HTMLDivElement>(null)

  const { status, setStatus } = useShowtimeSelection(showtime)

  // Back to the top on each new screening. The panel is docked and the rows it
  // serves look alike, so a card that swapped its contents while staying
  // scrolled to the seat map read as "nothing happened".
  useEffect(() => {
    rootRef.current
      ?.closest(`[${SIDE_PANEL_SCROLLER_ATTRIBUTE}]`)
      ?.scrollTo({ top: 0 })
  }, [showtimeId])

  // Render/output using the state and derived values prepared above.
  return (
    <Box
      ref={rootRef}
      position="relative"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      boxShadow="sm"
      overflow="hidden"
    >
      <Box
        position="sticky"
        top={0}
        zIndex={1}
        bg="bg.panel"
        borderBottomWidth="1px"
        borderColor="border.muted"
      >
        <ShowtimeDetailHeader showtime={showtime} />
        <Box position="absolute" top="8px" right="6px">
          <PanelIconButton label="Close" onClick={onClose}>
            <Box as={PanelIcon.close} boxSize="18px" />
          </PanelIconButton>
        </Box>
      </Box>

      {/* Keyed on the screening so switching rows replays the entrance rather
          than mutating one card into another in place. */}
      <Box key={showtimeId} animation="panel-enter 180ms ease-out">
        <ShowtimeAttendance showtime={showtime} />

        <Box px={3} pb={3}>
          <ShowtimeStatusControl
            status={status}
            onChange={setStatus}
            hasOpenInvite={Boolean(showtime.viewer?.invited_by?.length)}
          />
        </Box>

        <SeatAvailabilityPanel showtime={showtime} />

        {/* One line rather than a panel, in place of the sections a guest does
            not get: the panel is about this screening, not about signing up. */}
        {isSignedIn ? null : (
          <Box px={3} pb={3}>
            <PanelPressable
              type="button"
              onClick={() => requireAccount()}
              display="flex"
              alignItems="center"
              gap="6px"
              w="100%"
              px="10px"
              py="8px"
              borderRadius="10px"
              bg="app.blue.primary"
              color="app.blue.secondary"
              cursor="pointer"
              _focusVisible={{
                outline: "2px solid",
                outlineColor: "app.tint",
                outlineOffset: "1px",
              }}
            >
              <Box as={PanelIcon.mailOutline} boxSize="16px" flexShrink={0} aria-hidden />
              <Text fontSize="13px" fontWeight="600" flex="1" textAlign="left">
                Log in to invite friends
              </Text>
              <Box as={PanelIcon.arrowForward} boxSize="14px" flexShrink={0} aria-hidden />
            </PanelPressable>
          </Box>
        )}

        {/* A visibility mode on a screening you are not going to governs
            nothing, so it only appears once there is a status to hide. */}
        {status === "GOING" || status === "INTERESTED" ? (
          <ShowtimeVisibilityPanel showtime={showtime} />
        ) : null}

      </Box>
    </Box>
  )
}

export default ShowtimeDetailPanel
