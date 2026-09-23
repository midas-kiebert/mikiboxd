/**
 * The audience box: who else is at this screening, and who you have asked.
 *
 * Laid out as the app lays it out — one bordered box directly under the header,
 * holding a wrap of name pills. Empty (no one going or interested yet) shows
 * nothing above the invite panel, which already answers "so invite someone".
 * It sits *above* the status buttons on purpose, which is the app's order and
 * the right one: who is already going is usually what decides whether you are.
 *
 * The Letterboxd marks ("3 watchlisted", "2 watched") used to be full-width
 * rows in here. They are pills in the header now (`detail/FriendWatchPills`),
 * beside the poster where they cost no height, with the names in a popup.
 *
 * Everything here is already in the showtime payload the feed fetched
 * (`viewer.friends_going`, `friends_of_friends_*`), so opening the panel costs
 * no request at all and the box paints in the same frame as the header.
 *
 * Hidden entirely for a guest, who has no friends list for it to describe.
 */
import { Box } from "@chakra-ui/react"
import type { ShowtimePublic } from "shared"

import { useIsSignedIn } from "@/auth/useSession"
import FriendBadges from "@/components/Showtimes/detail/FriendBadges"
import ShowtimeInvitePanel from "@/components/Showtimes/detail/ShowtimeInvitePanel"

type ShowtimeAttendanceProps = {
  showtime: ShowtimePublic
}

const ShowtimeAttendance = ({ showtime }: ShowtimeAttendanceProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isSignedIn = useIsSignedIn()
  const viewer = showtime.viewer

  const going = viewer?.friends_going ?? []
  const interested = viewer?.friends_interested ?? []
  const beyondGoing = viewer?.friends_of_friends_going ?? []
  const beyondInterested = viewer?.friends_of_friends_interested ?? []

  const hasAudience =
    going.length +
      interested.length +
      beyondGoing.length +
      beyondInterested.length >
    0

  if (!isSignedIn) return null

  // Render/output using the state and derived values prepared above.
  return (
    <Box px={3} pt={4} pb={4}>
      <Box
        borderWidth="1px"
        borderColor="border"
        borderRadius="10px"
        bg="bg.subtle"
        overflow="hidden"
      >
        {/* Nothing at all when no one is going yet — the invite panel right
            below already answers "so invite someone", which is the only
            thing an empty-state sentence here could have said. */}
        {hasAudience ? (
          <Box px="10px" py="10px">
            <FriendBadges
              friendsGoing={going}
              friendsInterested={interested}
              friendsOfFriendsGoing={beyondGoing}
              friendsOfFriendsInterested={beyondInterested}
            />
          </Box>
        ) : null}

        {/* Inviting closes the box rather than the panel: "who would come if I
            asked" and asking them are one step apart, and down at the foot of
            the panel the picker opened below the fold where nobody saw it. */}
        <ShowtimeInvitePanel showtime={showtime} />
      </Box>
    </Box>
  )
}

export default ShowtimeAttendance
