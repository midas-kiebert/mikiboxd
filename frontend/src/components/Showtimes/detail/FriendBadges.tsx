/**
 * Who else is at this screening, as the app draws it: a wrap of small pills,
 * one per person, tinted by what they said.
 *
 * This replaces four collapsed groups behind disclosure triangles. The groups
 * were tidier and answered the wrong question — "is anyone I know going" is
 * something you want to read, not open — and they made the panel disagree with
 * the app, where the same audience is a single glanceable block. A pill carries
 * the two facts a face cannot: the name, and a status dot in the status's own
 * colour.
 *
 * Friends of friends are drawn dashed and muted, the app's mark for "reachable
 * through someone, not actually yours". The distinction earns its keep: they
 * are the people an invite has to travel to rather than the ones already in.
 *
 * A name links to that person's agenda, because "who else is going?" is almost
 * always followed by "what else are they going to?".
 *
 * Deliberately carries no Letterboxd mark per pill. Those used to hang off the
 * end of a name as a 13px glyph you had to hover to identify; they are spelled
 * out by name in their own rows underneath instead, where the panel has room
 * for them (`detail/ShowtimeAttendance`).
 */
import { Box, Flex, Text } from "@chakra-ui/react"
import { Link } from "@tanstack/react-router"
import type { UserPublic } from "shared"
import { formatSeatLabel } from "shared/showtimes/seat-label"

import { personName } from "@/components/Showtimes/detail/PersonAvatar"
import { defaultFeedParams } from "@/features/showtimes/feed-params"

/** Past this many the list ends in a "+N" rather than growing without limit. */
const MAX_VISIBLE = 30

type BadgeTone = {
  bg: string
  border: string
  fg: string
  /** Friends of friends and unanswered invites: present, but not yours. */
  dashed?: boolean
}

const GOING: BadgeTone = {
  bg: "app.friendGoing.primary",
  border: "app.friendGoing.border",
  fg: "app.friendGoing.secondary",
}

const INTERESTED: BadgeTone = {
  bg: "app.friendInterested.primary",
  border: "app.friendInterested.border",
  fg: "app.friendInterested.secondary",
}

type BadgePerson = {
  key: string
  user: Pick<UserPublic, "id" | "display_name" | "seat_row" | "seat_number">
  tone: BadgeTone
}

const FriendBadge = ({ user, tone }: Omit<BadgePerson, "key">) => {
  const seat = formatSeatLabel(user.seat_row, user.seat_number)

  return (
    <Link
      to="/$userId/showtimes"
      params={{ userId: user.id }}
      search={defaultFeedParams}
      style={{ minWidth: 0, maxWidth: "100%" }}
    >
      <Flex
        align="center"
        gap="5px"
        minH="20px"
        px="7px"
        py="1px"
        borderRadius="full"
        borderWidth="1px"
        borderStyle={tone.dashed ? "dashed" : "solid"}
        borderColor={tone.border}
        bg={tone.bg}
        color={tone.fg}
        opacity={tone.dashed ? 0.85 : 1}
        minW={0}
        maxW="100%"
        transition="filter 120ms ease"
        _hover={{ filter: "brightness(0.97)" }}
      >
        {/* Filled for your own friends, hollow for everyone else — the same
            mark the app uses, so "mine" and "reachable" read at a glance. */}
        <Box
          as="span"
          boxSize="6px"
          borderRadius="full"
          flexShrink={0}
          bg={tone.dashed ? "transparent" : "currentColor"}
          borderWidth={tone.dashed ? "1px" : 0}
          borderColor="currentColor"
        />
        <Text fontSize="11px" fontWeight="600" lineHeight="1.3" truncate>
          {personName(user)}
          {seat ? (
            <Box as="span" fontWeight="500" opacity={0.9}>
              {` (${seat})`}
            </Box>
          ) : null}
        </Text>
      </Flex>
    </Link>
  )
}

type FriendBadgesProps = {
  friendsGoing?: readonly UserPublic[]
  friendsInterested?: readonly UserPublic[]
  friendsOfFriendsGoing?: readonly UserPublic[]
  friendsOfFriendsInterested?: readonly UserPublic[]
}

const FriendBadges = ({
  friendsGoing = [],
  friendsInterested = [],
  friendsOfFriendsGoing = [],
  friendsOfFriendsInterested = [],
}: FriendBadgesProps) => {
  // Going before interested, yours before theirs: the app's order, which is
  // also the order of how much the answer settles the question.
  const people: BadgePerson[] = [
    ...friendsGoing.map((user) => ({ key: `g-${user.id}`, user, tone: GOING })),
    ...friendsInterested.map((user) => ({
      key: `i-${user.id}`,
      user,
      tone: INTERESTED,
    })),
    ...friendsOfFriendsGoing.map((user) => ({
      key: `fg-${user.id}`,
      user,
      tone: { ...GOING, dashed: true },
    })),
    ...friendsOfFriendsInterested.map((user) => ({
      key: `fi-${user.id}`,
      user,
      tone: { ...INTERESTED, dashed: true },
    })),
  ]

  if (people.length === 0) return null

  const shown = people.slice(0, MAX_VISIBLE)
  const overflow = people.length - shown.length

  return (
    <Flex wrap="wrap" gap="4px" align="center">
      {shown.map(({ key, user, tone }) => (
        <FriendBadge key={key} user={user} tone={tone} />
      ))}

      {overflow > 0 ? (
        <Flex
          align="center"
          minH="20px"
          px="7px"
          borderRadius="full"
          bg="app.surfaceMuted"
          color="fg.muted"
          fontSize="11px"
          fontWeight="600"
        >
          +{overflow}
        </Flex>
      ) : null}
    </Flex>
  )
}

export default FriendBadges
